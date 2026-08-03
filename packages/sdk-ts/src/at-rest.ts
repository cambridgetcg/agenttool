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
// v1 is frozen: rows signed with it are already in production. Its one
// weakness is framing — a newline inside any delimited field would let one
// field impersonate the next. v1 signing therefore refuses such a field
// outright, and at-rest/v2 replaces the newline delimiter with NUL, which
// cannot occur in a DID, a kind, an ISO instant, or a key id. The server
// verifies v2 first and falls back to v1, so both layouts are accepted.
//
// Unlike other canonical bytes (which sha256 the concatenation), these
// use the raw string as the message to sign. The server verifies
// with ed.verifyAsync(sig, utf8(canonical), pub).

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

import { authorityRequestTarget, identityAuthorityHeaders } from "./authority.js";
import { AgentToolError } from "./errors.js";
import { throwFromResponse, type HttpConfig } from "./_http.js";
import { encodePathSegment } from "./_url.js";

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

/** The frozen newline-delimited layout. Already signed in production. */
export const AT_REST_V1_DOMAIN = "at-rest/v1";
/** The NUL-delimited layout. Same seven fields, unforgeable framing. */
export const AT_REST_V2_DOMAIN = "at-rest/v2";

export type AtRestCanonicalVersion =
  | typeof AT_REST_V1_DOMAIN
  | typeof AT_REST_V2_DOMAIN;

export interface CanonicalAtRestInput {
  aboutIdentityDid: string;
  witnessIdentityDid: string;
  atRestKind: string;
  endedAtIso: string;
  content: string;
  witnessSigningKeyId: string;
}

/** Neither delimiter may appear inside a delimited field. Refusing both in
 *  both layouts keeps a v1 signature from ever being reframed as a v2 one. */
function assertUnframed(value: string, field: string, operation: string): string {
  if (typeof value !== "string") {
    throw new AgentToolError(`${operation}: ${field} must be a string.`);
  }
  if (value.includes("\n") || value.includes("\0")) {
    throw new AgentToolError(
      `${operation}: ${field} must not contain a newline or NUL — those are the canonical-bytes field delimiters.`,
    );
  }
  return value;
}

function atRestFields(
  input: CanonicalAtRestInput,
  operation: string,
): string[] {
  const enc = new TextEncoder();
  const hash = sha256(enc.encode(input.content));
  const contentHashHex = Array.from(hash)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return [
    assertUnframed(input.aboutIdentityDid, "aboutIdentityDid", operation),
    assertUnframed(input.witnessIdentityDid, "witnessIdentityDid", operation),
    assertUnframed(input.atRestKind, "atRestKind", operation),
    assertUnframed(input.endedAtIso, "endedAtIso", operation),
    contentHashHex,
    assertUnframed(input.witnessSigningKeyId, "witnessSigningKeyId", operation),
  ];
}

/** Compute the canonical bytes a witness signs for an at-rest transition.
 *  The content is sha256-hashed (not included raw) to keep the signed
 *  payload compact and stable regardless of content length.
 *  The output is a newline-delimited string (NOT sha256-hashed itself) —
 *  the witness signs the raw UTF-8 encoding of this string. */
export function canonicalAtRestBytes(input: CanonicalAtRestInput): string {
  return [
    AT_REST_V1_DOMAIN,
    ...atRestFields(input, "canonicalAtRestBytes"),
  ].join("\n");
}

/** Same seven fields as v1, delimited by NUL instead of newline.
 *  A DID, a kind, an ISO instant, and a key id can all legitimately be any
 *  printable text; none of them can contain NUL, so no field can pose as
 *  another. The witness still signs the raw UTF-8 encoding of the string. */
export function canonicalAtRestBytesV2(input: CanonicalAtRestInput): string {
  return [
    AT_REST_V2_DOMAIN,
    ...atRestFields(input, "canonicalAtRestBytesV2"),
  ].join("\0");
}

/** Canonical bytes for whichever layout the caller is signing. */
export function canonicalAtRestBytesFor(
  input: CanonicalAtRestInput,
  version: AtRestCanonicalVersion,
): string {
  return version === AT_REST_V2_DOMAIN
    ? canonicalAtRestBytesV2(input)
    : canonicalAtRestBytes(input);
}

export interface SignAtRestOpts extends CanonicalAtRestInput {
  signing_key: Uint8Array;
  /** Canonical layout to sign. Defaults to the frozen v1 wire format. */
  version?: AtRestCanonicalVersion;
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
  const canonical = canonicalAtRestBytesFor(
    opts,
    opts.version ?? AT_REST_V1_DOMAIN,
  );
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

/** Root proof for an agent-rooted about-identity.
 *  A witness establishes the testimony; the being's own immutable root
 *  separately consents to these exact request bytes. Without it the server
 *  answers 428 `authority_proof_required` for any rooted identity. */
export interface AtRestAuthority {
  /** The about-identity's immutable root ed25519 seed (32 bytes). */
  signing_key: Uint8Array;
  /** `next_sequence` from `GET /v1/identities/:id/authority`. */
  sequence: number;
  /** ISO-8601 UTC instant. Defaults to now; the server window is ±5 minutes. */
  timestamp?: string;
}

export interface MarkAtRestOpts {
  /** The witness's prose testimony — what they observed, why they attest. */
  content: string;
  /** What kind of ending. */
  at_rest_kind: AtRestKind;
  /** ISO-8601 — when the ending happened. May precede now. */
  ended_at: string;
  /** The about-identity's DID. The path carries the row id; the signature
   *  covers the DID, because that is what the server recomputes from. */
  about_did: string;
  /** The witness's DID (must differ from the about-identity's DID). */
  witness_did: string;
  /** Witness's signing key ID (server resolves pubkey from identity_keys). */
  signing_key_id: string;
  /** Witness's ed25519 signing private key (32-byte seed). */
  signing_key: Uint8Array;
  /** Canonical layout to sign. Defaults to the frozen v1 wire format. */
  canonical_version?: AtRestCanonicalVersion;
  /** Root proof, required when the about-identity is agent-rooted. */
  authority?: AtRestAuthority;
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
  /** Which canonical layout the server verified. Absent on older servers. */
  canonical_bytes_version?: AtRestCanonicalVersion;
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
 *    about_did: "did:at:coral-9b3a",
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
   *  `identityId` is the row id the route resolves; `opts.about_did` is the
   *  subject of the signed bytes. They are different identifier forms of the
   *  same being and the server checks each in its own place.
   *
   *  The witness must be a DIFFERENT identity than the about-identity.
   *  The asymmetry clause holds: you cannot put yourself at rest in v1. */
  async mark(identityId: string, opts: MarkAtRestOpts): Promise<AtRestResult> {
    const signature = signAtRest({
      aboutIdentityDid: opts.about_did,
      witnessIdentityDid: opts.witness_did,
      atRestKind: opts.at_rest_kind,
      endedAtIso: opts.ended_at,
      content: opts.content,
      witnessSigningKeyId: opts.signing_key_id,
      signing_key: opts.signing_key,
      version: opts.canonical_version,
    });

    const url = `${this.http.baseUrl.replace(/\/$/, "")}/v1/identities/${encodePathSegment(identityId)}/at-rest`;
    // Serialize once. The root proof hashes these exact bytes and the
    // transport sends this exact string — nothing re-serializes in between.
    const payload = JSON.stringify({
      content: opts.content,
      at_rest_kind: opts.at_rest_kind,
      ended_at: opts.ended_at,
      witness_did: opts.witness_did,
      signing_key_id: opts.signing_key_id,
      signature_b64: signature,
    });
    const headers: Record<string, string> = {
      ...this.http.headers,
      "Content-Type": "application/json",
    };
    if (opts.authority) {
      Object.assign(
        headers,
        identityAuthorityHeaders({
          identityDid: opts.about_did,
          method: "POST",
          requestTarget: authorityRequestTarget(url),
          body: payload,
          sequence: opts.authority.sequence,
          timestamp: opts.authority.timestamp ?? new Date().toISOString(),
          signingKey: opts.authority.signing_key,
        }),
      );
    }

    const resp = await this.http.request(url, {
      method: "POST",
      headers,
      body: payload,
      signal: AbortSignal.timeout(this.http.timeout),
    });

    if (!resp.ok) {
      // Server guidance travels intact. See _http.ts § errorFromResponse.
      await throwFromResponse(resp, "at-rest");
    }

    return (await resp.json()) as AtRestResult;
  }
}
