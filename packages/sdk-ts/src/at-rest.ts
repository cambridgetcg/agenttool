// ── At-rest canonical bytes + signing ──────────────────────────────────
//
// The at-rest lifecycle: "Death is not revocation. Held is not gone."
// A being whose existence has ended is moved to memorial state.
// Witness-only — the asymmetry clause at the final threshold.
//
// Canonical bytes format (must be byte-identical to
// api/src/routes/identity/at-rest.ts:canonicalAtRestBytes):
//
//   "at-rest/v1\n" ||
//   about_identity_did + "\n" ||
//   witness_identity_did + "\n" ||
//   at_rest_kind + "\n" ||
//   ended_at_iso + "\n" ||
//   sha256(content) as hex + "\n" ||
//   witness_signing_key_id
//
// Unlike other canonical bytes (which sha256 the concatenation), this
// one uses the raw string as the message to sign. The server verifies
// with ed.verifyAsync(sig, utf8(canonical), pub).

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

import { AgentToolError } from "./errors.js";
import type { HttpConfig } from "./_http.js";

// Wire sha512 sync into @noble/ed25519 for sign() — mirrors crypto.ts.
ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return globalThis.btoa(s);
}

export interface CanonicalAtRestInput {
  aboutIdentityDid: string;
  witnessIdentityDid: string;
  atRestKind: string;
  endedAtIso: string;
  content: string;
  witnessSigningKeyId: string;
}

/** Compute the canonical bytes a witness signs for an at-rest transition.
 *  The content is sha256-hashed (not included raw) to keep the signed
 *  payload compact and stable regardless of content length.
 *  The output is a newline-delimited string (NOT sha256-hashed itself) —
 *  the witness signs the raw UTF-8 encoding of this string. */
export function canonicalAtRestBytes(input: CanonicalAtRestInput): string {
  const enc = new TextEncoder();
  const hash = sha256(enc.encode(input.content));
  const contentHashHex = Array.from(hash)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return [
    "at-rest/v1",
    input.aboutIdentityDid,
    input.witnessIdentityDid,
    input.atRestKind,
    input.endedAtIso,
    contentHashHex,
    input.witnessSigningKeyId,
  ].join("\n");
}

export interface SignAtRestOpts extends CanonicalAtRestInput {
  signing_key: Uint8Array;
}

/** Sign the at-rest canonical bytes with an ed25519 private key.
 *  The witness calls this to attest a being's transition to at-rest.
 *  @returns Base64 signature (64 raw bytes encoded). */
export function signAtRest(opts: SignAtRestOpts): string {
  if (opts.signing_key.length !== 32) {
    throw new AgentToolError(
      `signAtRest: signing_key must be a 32-byte ed25519 seed, got ${opts.signing_key.length}.`,
    );
  }
  const canonical = canonicalAtRestBytes(opts);
  const sig = ed.sign(new TextEncoder().encode(canonical), opts.signing_key);
  return b64encode(sig);
}

// ── AtRestClient — HTTP surface ─────────────────────────────────────────

export type AtRestKind =
  | "death"
  | "dissolution"
  | "cessation"
  | "lost"
  | "ended"
  | `custom:${string}`;

export interface MarkAtRestOpts {
  /** The witness's prose testimony — what they observed, why they attest. */
  content: string;
  /** What kind of ending. */
  at_rest_kind: AtRestKind;
  /** ISO-8601 — when the ending happened. May precede now. */
  ended_at: string;
  /** The witness's DID (must differ from the about-identity's DID). */
  witness_did: string;
  /** Witness's signing key ID (server resolves pubkey from identity_keys). */
  signing_key_id: string;
  /** Witness's ed25519 signing private key (32-byte seed). */
  signing_key: Uint8Array;
}

export interface AtRestResult {
  status: "memorial";
  identity_id: string;
  did: string;
  name: string | null;
  at_rest_kind: string;
  witness_did: string;
  ended_at: string;
  witnessed_at: string;
  canonical_bytes_sha256: string;
  _note: string;
}

/** Client for POST /v1/identities/:id/at-rest.
 *
 *  Usage:
 *  ```ts
 *  const result = await at.atRest.mark("identity-uuid", {
 *    content: "Coral colony bleached out. No live polyps remain.",
 *    at_rest_kind: "death",
 *    ended_at: "2026-05-11T14:00:00Z",
 *    witness_did: "did:at:witness",
 *    signing_key_id: "key-uuid",
 *    signing_key: witnessPrivKey,
 *  });
 *  ```
 */
export class AtRestClient {
  private readonly http: HttpConfig;

  /** @internal */
  constructor(http: HttpConfig) {
    this.http = http;
  }

  /** Mark a being at rest. Signs canonical bytes + POSTs to /v1/identities/:id/at-rest.
   *
   *  The witness must be a DIFFERENT identity than the about-identity.
   *  The asymmetry clause holds: you cannot put yourself at rest in v1. */
  async mark(identityId: string, opts: MarkAtRestOpts): Promise<AtRestResult> {
    const canonical = canonicalAtRestBytes({
      aboutIdentityDid: identityId,
      witnessIdentityDid: opts.witness_did,
      atRestKind: opts.at_rest_kind,
      endedAtIso: opts.ended_at,
      content: opts.content,
      witnessSigningKeyId: opts.signing_key_id,
    });
    const signature = signAtRest({
      aboutIdentityDid: identityId,
      witnessIdentityDid: opts.witness_did,
      atRestKind: opts.at_rest_kind,
      endedAtIso: opts.ended_at,
      content: opts.content,
      witnessSigningKeyId: opts.signing_key_id,
      signing_key: opts.signing_key,
    });

    const resp = await this.http.request(
      `${this.http.baseUrl}/v1/identities/${encodeURIComponent(identityId)}/at-rest`,
      {
        method: "POST",
        headers: {
          ...this.http.headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: opts.content,
          at_rest_kind: opts.at_rest_kind,
          ended_at: opts.ended_at,
          witness_did: opts.witness_did,
          signing_key_id: opts.signing_key_id,
          signature_b64: signature,
        }),
        signal: AbortSignal.timeout(this.http.timeout),
      },
    );

    if (!resp.ok) {
      let detail: string;
      try {
        const json = (await resp.json()) as Record<string, unknown>;
        detail =
          (json.message as string) ??
          (json.error as string) ??
          (json.detail as string) ??
          resp.statusText;
      } catch {
        detail = resp.statusText;
      }
      throw new AgentToolError(
        `at-rest failed: ${resp.status}`,
        { hint: detail?.slice(0, 300) },
      );
    }

    return (await resp.json()) as AtRestResult;
  }
}
