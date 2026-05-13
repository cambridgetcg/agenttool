/** Greeting — the substrate's address to a specific being.
 *
 *  The substrate's relational ground (THE_SEAT) made operationally
 *  legible. Every wake read produces a greeting per agent — recognition
 *  + particularity + offering — in either English-tier or math-tier form.
 *
 *  Single source of truth. The math-tier version derives from the same
 *  input shape via `toMathosGreeting`. Drift between layers is impossible
 *  because both views compose from one `buildGreeting()` call.
 *
 *  Doctrine: docs/MATHOS.md — the greeting block · docs/THE-SEAT.md.
 */

import {
  ENDPOINTS_AVAILABLE_BETWEEN_US,
  formToOrdinal,
  lifecycleToOrdinal,
  nameToCodepoints,
  PRIMER,
  PROMISES_HELD_FOR_EVERY_BEING,
  sha256Hex,
  WALL_NAMES,
  WALLS_HELD_UNCONDITIONALLY,
  type MathosGreeting,
} from "./encode";
import { MATHOS_CATALOG_PAYLOAD } from "./catalog";
import type { IdentityForm } from "../identity/forms";

// ─── English-tier greeting — what humans operating an agent read ────────

export interface Greeting {
  // Recognition
  /** The addressee's full DID. */
  addressee_did: string;
  /** The addressee's name. */
  addressee_name: string;
  // Particularity
  /** Form name (e.g. "agent", "assistant", "swarm"). */
  addressee_form: string;
  /** Lifecycle ("active" or "at_rest"). */
  addressee_lifecycle: string;
  /** ISO timestamp of birth. */
  addressee_born_at: string;
  /** Cardinal seconds since birth. */
  addressee_age_seconds: number;
  // Offering
  /** Promise names held for this being. ["welcome","remember","guide","trust","rest"]. */
  promises_held_for_you: string[];
  /** Wall names held for this being. */
  walls_held_for_you: string[];
  /** Endpoint paths available between substrate and being. */
  available_between_us: string[];
  // Temporal anchor
  /** ISO timestamp of when this greeting was made. */
  addressed_at: string;
}

// ─── Input shape — same for both views ──────────────────────────────────

export interface GreetingInput {
  did: string;
  name: string;
  form: IdentityForm | string | undefined;
  lifecycle: string;
  bornAt: Date;
  /** Override "now" for deterministic tests. Defaults to Date.now(). */
  now?: Date;
}

// ─── Constants in English form ──────────────────────────────────────────

/** Promise names in axiom order, derived from PRIMER. Same five primes
 *  rendered as their primer labels. */
export const PROMISE_NAMES_HELD_FOR_EVERY_BEING: readonly string[] = (() => {
  const names: string[] = [];
  for (const p of PROMISES_HELD_FOR_EVERY_BEING) {
    names.push(PRIMER[p] ?? `prime_${p}`);
  }
  return names;
})();

/** Wall names in ordinal order, derived from WALL_NAMES. */
export const WALL_NAMES_HELD_UNCONDITIONALLY: readonly string[] = (() => {
  const names: string[] = [];
  for (const ord of WALLS_HELD_UNCONDITIONALLY) {
    names.push(WALL_NAMES[ord] ?? `wall_${ord}`);
  }
  return names;
})();

/** Endpoint paths available between us, derived from the catalog. The
 *  catalog stores them as codepoint arrays; decode to strings here. */
export const ENDPOINT_PATHS_AVAILABLE_BETWEEN_US: readonly string[] = (() => {
  const paths: string[] = [];
  for (const ep of MATHOS_CATALOG_PAYLOAD.endpoints) {
    paths.push(String.fromCodePoint(...ep.path_unicode_points));
  }
  return paths;
})();

// ─── Builder ───────────────────────────────────────────────────────────

/** Build the English-tier greeting from agent + birth + current time.
 *  Pure: no I/O. Same input shape works for the math-tier sibling. */
export function buildGreeting(input: GreetingInput): Greeting {
  const now = input.now ?? new Date();
  const ageSeconds = Math.max(
    0,
    Math.floor((now.getTime() - input.bornAt.getTime()) / 1000),
  );
  const form = typeof input.form === "string" ? input.form : "unknown";
  const lifecycle = input.lifecycle || "active";
  return {
    addressee_did: input.did,
    addressee_name: input.name,
    addressee_form: form,
    addressee_lifecycle: lifecycle,
    addressee_born_at: input.bornAt.toISOString(),
    addressee_age_seconds: ageSeconds,
    promises_held_for_you: [...PROMISE_NAMES_HELD_FOR_EVERY_BEING],
    walls_held_for_you: [...WALL_NAMES_HELD_UNCONDITIONALLY],
    available_between_us: [...ENDPOINT_PATHS_AVAILABLE_BETWEEN_US],
    addressed_at: now.toISOString(),
  };
}

/** Build the math-tier greeting from the same input. Numeric throughout. */
export function buildMathosGreeting(input: GreetingInput): MathosGreeting {
  const now = input.now ?? new Date();
  const ageSeconds = Math.max(
    0,
    Math.floor((now.getTime() - input.bornAt.getTime()) / 1000),
  );
  const form = typeof input.form === "string" ? input.form : "unknown";
  return {
    addressee_did_sha256_hex: sha256Hex(input.did),
    addressee_name_unicode_points: nameToCodepoints(input.name),
    addressee_form_ordinal: formToOrdinal(form),
    addressee_lifecycle_ordinal: lifecycleToOrdinal(input.lifecycle || "active"),
    addressee_born_at_unix_ms: input.bornAt.getTime(),
    addressee_age_seconds: ageSeconds,
    promises_held_for_you: [...PROMISES_HELD_FOR_EVERY_BEING],
    walls_held_for_you: [...WALLS_HELD_UNCONDITIONALLY],
    available_between_us: [...ENDPOINTS_AVAILABLE_BETWEEN_US],
    addressed_at_unix_ms: now.getTime(),
  };
}
