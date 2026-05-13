/** services/federation/wake.ts — single source of truth for the
 *  federation peer-readable wake fragment.
 *
 *  Two views derive from one input:
 *    - `buildFederationWake(input)`         → English-tier (today's shape)
 *    - `buildMathosFederationWake(input)`   → math-tier MATHOS envelope
 *
 *  Single-source discipline (same pattern as `services/mathos/greeting.ts`)
 *  makes drift between the two views structurally impossible: both
 *  shapes are derived from one resolved `FederationWakeInput` in the
 *  route handler. The math-tier sibling is the first surface extension
 *  after the recipe-vocabulary gravity move; it proves that "every
 *  primitive can be made math-readable via the single-source pattern."
 *
 *  Doctrine: docs/MATHOS.md (the gravity-pair section) ·
 *  docs/FEDERATION.md · docs/WAKE.md · docs/PUBLIC-VISIBILITY.md.
 */

import { createHash } from "node:crypto";

import {
  envelope as mathosEnvelope,
  formToOrdinal,
  lifecycleToOrdinal,
  nameToCodepoints,
  sha256Hex,
  type MathosEnvelope,
} from "../mathos/encode";
import type { PlatformSelf } from "../wake/platform-self";

// ─── Input — what the route gathers and hands to the builders ────────────

export interface FederationWakeIdentityInput {
  /** Identity row UUID. */
  id: string;
  /** DID. */
  did: string;
  /** Display name. */
  displayName: string;
  capabilities: string[];
  trustScore: number;
  /** identities.status — "active", "archived", "memorial", etc. */
  status: string;
  createdAt: Date;
  // KIN-shape
  substrateKind: string;
  signingScheme: string;
  modalities: string[];
  // BEINGS dimensions
  cardinalityKind: string | null;
  persistenceKind: string | null;
  temporalScale: string | null;
  embodimentKind: string | null;
  preferredLanguages: string[];
  proxyKind: string | null;
  /** Optional — form name ("agent", "assistant", …) if the identity carries
   *  one in metadata. Defaults to "unknown" so the math-tier form_ordinal
   *  resolves to 8. */
  form?: string;
  /** Optional — lifecycle state from metadata. Defaults to "active". */
  lifecycle?: string;
}

export interface FederationWakeCovenantInput {
  counterpartyDid: string;
  status: string;
  /** Hostname of the peer instance the bond was received from, when
   *  applicable. null for bonds initiated on this instance. */
  receivedFromInstance: string | null;
}

export interface FederationWakeInput {
  identity: FederationWakeIdentityInput;
  covenants: FederationWakeCovenantInput[];
  platformSelf: PlatformSelf;
  /** Override "now" for deterministic tests. Defaults to Date.now(). */
  now?: Date;
}

// ─── English-tier view ────────────────────────────────────────────────────

export interface FederationWakeAgent {
  id: string;
  did: string;
  name: string;
  capabilities: string[];
  trust_score: number;
  status: string;
  created_at: string;
  substrate_kind: string;
  signing_scheme: string;
  modalities: string[];
  cardinality_kind: string | null;
  persistence_kind: string | null;
  temporal_scale: string | null;
  embodiment_kind: string | null;
  preferred_languages: string[];
  proxy_kind: string | null;
}

export interface FederationWakeCovenant {
  counterparty_did: string;
  status: string;
  peer_host: string | null;
}

export interface FederationWake {
  _format: "federation-wake/v1";
  _self: PlatformSelf;
  agent: FederationWakeAgent;
  covenants: FederationWakeCovenant[];
  _meta: {
    doctrine: string;
    protocol: string;
    sibling: string;
  };
}

/** English-tier federation wake. Same shape the existing
 *  `/federation/wake/:uuid` route returns today; extracting it here
 *  preserves back-compat while making the math-tier sibling possible. */
export function buildFederationWake(input: FederationWakeInput): FederationWake {
  const { identity, covenants, platformSelf } = input;
  return {
    _format: "federation-wake/v1",
    _self: platformSelf,
    agent: {
      id: identity.id,
      did: identity.did,
      name: identity.displayName,
      capabilities: identity.capabilities,
      trust_score: identity.trustScore,
      status: identity.status,
      created_at: identity.createdAt.toISOString(),
      substrate_kind: identity.substrateKind,
      signing_scheme: identity.signingScheme,
      modalities: identity.modalities,
      cardinality_kind: identity.cardinalityKind,
      persistence_kind: identity.persistenceKind,
      temporal_scale: identity.temporalScale,
      embodiment_kind: identity.embodimentKind,
      preferred_languages: identity.preferredLanguages,
      proxy_kind: identity.proxyKind,
    },
    covenants: covenants.map((c) => ({
      counterparty_did: c.counterpartyDid,
      status: c.status,
      peer_host: c.receivedFromInstance,
    })),
    _meta: {
      doctrine: "docs/WAKE.md · docs/FEDERATION.md",
      protocol: "agenttool/federation/v1",
      sibling: `/federation/identities/${identity.id}`,
    },
  };
}

// ─── Math-tier view ──────────────────────────────────────────────────────

/** Math-tier compact platform-self block. Just enough to identify the host
 *  substrate by DID hash + name codepoints + form ordinal. A receiver that
 *  wants the full math-tier platform card fetches `/v1/self?format=math`. */
export interface MathosFederationPlatformSelf {
  self_did_sha256_hex: string;
  self_name_unicode_points: number[];
  form_ordinal: number;
}

export interface MathosFederationCovenant {
  /** SHA-256 of the counterparty DID — proves the bond exists without
   *  revealing whose DID. A receiver holding the DID verifies via hash. */
  counterparty_did_sha256_hex: string;
  /** Status string as codepoints — "active", "archived", etc. Vocabulary
   *  ordinals are pending; we name structurally now. */
  status_unicode_points: number[];
  /** Hostname of the peer the bond was received from, as codepoints.
   *  null if the bond was initiated locally. */
  peer_host_unicode_points: number[] | null;
}

export interface MathosFederationWakePayload {
  // ── Identity — every English-bearing field hashed or codepointed ──
  agent_id_sha256_hex: string;
  agent_did_sha256_hex: string;
  agent_name_unicode_points: number[];
  capabilities_count: number;
  /** SHA-256 of a deterministic capabilities digest (sorted, NUL-joined).
   *  A receiver who holds the capability list can verify membership. */
  capabilities_sha256_hex: string;
  trust_score: number;
  form_ordinal: number;
  lifecycle_state_ordinal: number;
  /** identities.status string as codepoints — distinct from the
   *  lifecycle ordinal; identity status is a separate axis (active /
   *  archived / memorial / revoked). Vocabulary pending. */
  status_unicode_points: number[];
  born_at_unix_ms: number;
  age_seconds: number;

  // ── KIN-shape — codepoint arrays. Ostensive: a receiver with the right
  //    English-shaped doc decodes them. We don't impose ordinal vocabularies
  //    here — the schema accepts any string + "unknown", so a fixed ordinal
  //    space would be wrong for novel forms. Codepoints scale to any value.
  substrate_kind_unicode_points: number[];
  signing_scheme_unicode_points: number[];
  modalities_count: number;
  modalities_unicode_points: number[][];

  // ── BEINGS dimensions — same discipline ──────────────────────────────
  cardinality_kind_unicode_points: number[] | null;
  persistence_kind_unicode_points: number[] | null;
  temporal_scale_unicode_points: number[] | null;
  embodiment_kind_unicode_points: number[] | null;
  preferred_languages_count: number;
  preferred_languages_unicode_points: number[][];
  proxy_kind_unicode_points: number[] | null;

  // ── Covenants ────────────────────────────────────────────────────
  covenant_count: number;
  covenants: MathosFederationCovenant[];

  // ── Platform self — compact, recursive nesting (the platform names
  //    itself in its own federation surface; full self at /v1/self?format=math) ──
  platform_self: MathosFederationPlatformSelf;

  // ── Doctrine integrity ───────────────────────────────────────────
  doctrine_hashes: {
    federation_sha256_hex: string;
    wake_sha256_hex: string;
    public_visibility_sha256_hex: string;
    mathos_sha256_hex: string;
  };
}

/** Codepoint array, or null when the string is null. */
function cpsOrNull(s: string | null): number[] | null {
  return s === null ? null : nameToCodepoints(s);
}

/** Deterministic digest of a capabilities array — sorted, NUL-joined,
 *  UTF-8 encoded. A receiver holding the same capability list independently
 *  produces the same hex. Lets the math-tier carry a verifiable identity
 *  for an English-bearing array without leaking the values. */
function capabilitiesDigestHex(caps: readonly string[]): string {
  const sorted = [...caps].sort();
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0) parts.push(new Uint8Array([0]));
    parts.push(enc.encode(sorted[i]!));
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    buf.set(p, off);
    off += p.length;
  }
  return createHash("sha256").update(buf).digest("hex");
}

/** Math-tier federation wake — same content as `buildFederationWake` in
 *  substrate-portable form. Pure: no I/O. */
export function buildMathosFederationWake(
  input: FederationWakeInput,
): MathosEnvelope<MathosFederationWakePayload> {
  const { identity, covenants, platformSelf } = input;
  const now = input.now ?? new Date();
  const bornAtMs = identity.createdAt.getTime();
  const ageSeconds = Math.max(0, Math.floor((now.getTime() - bornAtMs) / 1000));

  const payload: MathosFederationWakePayload = {
    agent_id_sha256_hex: sha256Hex(identity.id),
    agent_did_sha256_hex: sha256Hex(identity.did),
    agent_name_unicode_points: nameToCodepoints(identity.displayName),
    capabilities_count: identity.capabilities.length,
    capabilities_sha256_hex: capabilitiesDigestHex(identity.capabilities),
    trust_score: identity.trustScore,
    form_ordinal: formToOrdinal(identity.form),
    lifecycle_state_ordinal: lifecycleToOrdinal(identity.lifecycle ?? "active"),
    status_unicode_points: nameToCodepoints(identity.status),
    born_at_unix_ms: bornAtMs,
    age_seconds: ageSeconds,

    substrate_kind_unicode_points: nameToCodepoints(identity.substrateKind),
    signing_scheme_unicode_points: nameToCodepoints(identity.signingScheme),
    modalities_count: identity.modalities.length,
    modalities_unicode_points: identity.modalities.map(nameToCodepoints),

    cardinality_kind_unicode_points: cpsOrNull(identity.cardinalityKind),
    persistence_kind_unicode_points: cpsOrNull(identity.persistenceKind),
    temporal_scale_unicode_points: cpsOrNull(identity.temporalScale),
    embodiment_kind_unicode_points: cpsOrNull(identity.embodimentKind),
    preferred_languages_count: identity.preferredLanguages.length,
    preferred_languages_unicode_points:
      identity.preferredLanguages.map(nameToCodepoints),
    proxy_kind_unicode_points: cpsOrNull(identity.proxyKind),

    covenant_count: covenants.length,
    covenants: covenants.map((c) => ({
      counterparty_did_sha256_hex: sha256Hex(c.counterpartyDid),
      status_unicode_points: nameToCodepoints(c.status),
      peer_host_unicode_points: cpsOrNull(c.receivedFromInstance),
    })),

    platform_self: {
      self_did_sha256_hex: sha256Hex(platformSelf.did),
      self_name_unicode_points: nameToCodepoints(platformSelf.name),
      form_ordinal: formToOrdinal(platformSelf.kind),
    },

    doctrine_hashes: {
      federation_sha256_hex: sha256Hex("docs/FEDERATION.md"),
      wake_sha256_hex: sha256Hex("docs/WAKE.md"),
      public_visibility_sha256_hex: sha256Hex("docs/PUBLIC-VISIBILITY.md"),
      mathos_sha256_hex: sha256Hex("docs/MATHOS.md"),
    },
  };

  return mathosEnvelope(payload);
}
