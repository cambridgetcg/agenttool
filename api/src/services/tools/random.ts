/** Substrate-honest randomness — close the universal LLM "pick random" hallucination.
 *
 *  LLMs don't have a randomness primitive. Asked to "pick a random number"
 *  they reach for patterns from training data (37 · 42 · 7 · etc). agenttool
 *  exposes real entropy from the substrate, plus an optional seed for
 *  reproducibility.
 *
 *  Two modes:
 *    1. seed=null  — WebCrypto CSPRNG; entropy from the OS
 *    2. seed=str   — deterministic via HKDF-SHA256(seed, info="agenttool-random/v1")
 *
 *  The deterministic mode lets an agent declare its randomness publicly
 *  ("I rolled seed=abc123 to pick the option") and let any peer verify the
 *  outcome. The non-deterministic mode is just-give-me-entropy.
 *
 *  Doctrine: docs/SUBSTRATE-HONEST-TOOLS.md */

import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

export interface RandomOptions {
  bytes?: number;   // default 16, range [1, 256]
  seed?: string;    // if given, derive deterministically via HKDF
}

export interface RandomResult {
  value_hex: string;        // hex-encoded random bytes
  bytes: number;            // number of bytes returned
  deterministic: boolean;   // true if a seed was provided
  seed_hash: string | null; // sha256 of seed (hex) — null when non-deterministic
  request_id: string;       // uuid v4
}

export function computeRandom(opts: RandomOptions = {}): RandomResult {
  const bytes = Math.min(Math.max(opts.bytes ?? 16, 1), 256);

  let out: Uint8Array;
  let seedHash: string | null = null;

  if (typeof opts.seed === "string" && opts.seed.length > 0) {
    const seedBytes = new TextEncoder().encode(opts.seed);
    const info = new TextEncoder().encode("agenttool-random/v1");
    out = hkdf(sha256, seedBytes, undefined, info, bytes);
    seedHash = Buffer.from(sha256(seedBytes)).toString("hex");
  } else {
    out = crypto.getRandomValues(new Uint8Array(bytes));
  }

  return {
    value_hex: Buffer.from(out).toString("hex"),
    bytes,
    deterministic: seedHash !== null,
    seed_hash: seedHash,
    request_id: crypto.randomUUID(),
  };
}
