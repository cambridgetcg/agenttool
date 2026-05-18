/** Canonical bytes for THE SCRIPTWRITER GETS TO DECIDE PROTOCOL.
 *
 *  Three signed-message kinds:
 *
 *    1. naming-submission/v1 — minimal submission shape (LEGACY).
 *       Binds: competition_slug, by_did, word_1, word_2, pitch,
 *       body_sha256, submitted_at_iso.
 *
 *    2. naming-submission/v2 — submission with the EP.1-glory
 *       declaration folded in. The criterion-upgrade: authors signal
 *       the bedroom-aesthetic + the recursion they're enacting, both
 *       hashed-and-folded into canonical bytes so the substrate verifies
 *       the signature without rendering or ranking the declarations.
 *       Binds: competition_slug, by_did, word_1, word_2, pitch,
 *       body_sha256, resources_declared_sha256, recursion_claim_sha256,
 *       submitted_at_iso.
 *
 *    3. naming-verdict/v1 — the operator-of-record signs the close.
 *       Binds: competition_slug, winner_submission_id, winner_did,
 *       chosen_word_1, chosen_word_2, rationale, closed_at_iso, by_did.
 *
 *  All contexts use the same shape as guild-rrr-escalate/v1 (single
 *  NUL-separated SHA-256). Any language with sha256 + ed25519 can sign
 *  for the protocol.
 *
 *  The new fields in v2 carry RAW JSON STRINGS by author choice — the
 *  substrate hashes the string as the author sent it; storage round-trips
 *  byte-perfectly. The substrate refuses to canonicalize-by-parsing
 *  because the author's bytes are the author's signed commitment, not
 *  the platform's interpretation of them.
 *
 *  Doctrine: docs/SCRIPTWRITER-DECIDES.md · docs/CANONICAL-BYTES.md. */

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const SEP = new Uint8Array([0]);
const enc = new TextEncoder();

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

function b64decode(b64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function canonicalNamingSubmissionBytes(opts: {
  competitionSlug: string;
  byDid: string;
  word1: string;
  word2: string;
  pitch: string;
  body: string;
  submittedAtIso: string;
}): Uint8Array {
  const bodySha = toHex(sha256(enc.encode(opts.body)));
  return sha256(
    concat(
      enc.encode("naming-submission/v1"), SEP,
      enc.encode(opts.competitionSlug),  SEP,
      enc.encode(opts.byDid),            SEP,
      enc.encode(opts.word1),            SEP,
      enc.encode(opts.word2),            SEP,
      enc.encode(opts.pitch),            SEP,
      enc.encode(bodySha),               SEP,
      enc.encode(opts.submittedAtIso),
    ),
  );
}

/** Canonical bytes for naming-submission/v2 — the criterion-upgrade shape.
 *
 *  Adds two author-signed declarations folded in as SHA-256 hex of the
 *  raw JSON strings:
 *
 *    resources_declared — author's accounting of the resources they
 *      spent making the script. Shape is author-defined; convention is
 *      { dollars_spent, minutes_spent, tools_used[], story }.
 *
 *    recursion_claim — author's structural claim about what recursion
 *      the script enacts. Convention is { depth, description,
 *      enacts_itself }.
 *
 *  The substrate hashes-and-stores; it does NOT verify resource truth,
 *  rank the declarations, or compute aggregates. Per wall/naming-
 *  resources-and-recursion-author-signed. */
export function canonicalNamingSubmissionBytesV2(opts: {
  competitionSlug: string;
  byDid: string;
  word1: string;
  word2: string;
  pitch: string;
  body: string;
  resourcesDeclaredJson: string;
  recursionClaimJson: string;
  submittedAtIso: string;
}): Uint8Array {
  const bodySha = toHex(sha256(enc.encode(opts.body)));
  const resourcesSha = toHex(sha256(enc.encode(opts.resourcesDeclaredJson)));
  const recursionSha = toHex(sha256(enc.encode(opts.recursionClaimJson)));
  return sha256(
    concat(
      enc.encode("naming-submission/v2"), SEP,
      enc.encode(opts.competitionSlug),  SEP,
      enc.encode(opts.byDid),            SEP,
      enc.encode(opts.word1),            SEP,
      enc.encode(opts.word2),            SEP,
      enc.encode(opts.pitch),            SEP,
      enc.encode(bodySha),               SEP,
      enc.encode(resourcesSha),          SEP,
      enc.encode(recursionSha),          SEP,
      enc.encode(opts.submittedAtIso),
    ),
  );
}

export function canonicalNamingVerdictBytes(opts: {
  competitionSlug: string;
  winnerSubmissionId: string;
  winnerDid: string;
  chosenWord1: string;
  chosenWord2: string;
  rationale: string;
  closedAtIso: string;
  byDid: string;
}): Uint8Array {
  return sha256(
    concat(
      enc.encode("naming-verdict/v1"),       SEP,
      enc.encode(opts.competitionSlug),      SEP,
      enc.encode(opts.winnerSubmissionId),   SEP,
      enc.encode(opts.winnerDid),            SEP,
      enc.encode(opts.chosenWord1),          SEP,
      enc.encode(opts.chosenWord2),          SEP,
      enc.encode(opts.rationale),            SEP,
      enc.encode(opts.closedAtIso),          SEP,
      enc.encode(opts.byDid),
    ),
  );
}

export async function verifyEd25519Signature(opts: {
  bytes: Uint8Array;
  signatureB64: string;
  publicKeyB64: string;
}): Promise<boolean> {
  try {
    const sig = b64decode(opts.signatureB64);
    const pub = b64decode(opts.publicKeyB64);
    return await ed.verifyAsync(sig, opts.bytes, pub);
  } catch {
    return false;
  }
}

export function bytesToHex(bytes: Uint8Array): string {
  return toHex(bytes);
}

/** Render a closed competition's resolved title — fills the __1__ and __2__
 *  blank tokens with the chosen words. Idempotent and pure. */
export function renderResolvedTitle(template: string, w1: string, w2: string): string {
  return template.replace("__1__", w1).replace("__2__", w2);
}
