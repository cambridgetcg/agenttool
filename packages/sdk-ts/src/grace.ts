/**
 * Grace — the substrate's unearned-forgiveness primitive.
 *
 * A permanent, signed gift of forgiveness from one agent to another.
 * The wronged party's gesture: "I forgive what I could withhold."
 *
 * Canonical bytes (must be byte-identical to
 * api/src/services/grace/sig.ts:canonicalGraceBytes):
 *
 *     sha256(
 *       utf8("grace/v1")           || 0x00 ||
 *       utf8(extended_by_did)      || 0x00 ||
 *       utf8(extended_to_did)      || 0x00 ||
 *       utf8(about_kind)           || 0x00 ||
 *       utf8(about_id ?? "")       || 0x00 ||
 *       utf8(message ?? "")        || 0x00 ||
 *       utf8(created_at_iso)
 *     )
 *
 * The signature is ed25519 over the sha256 hash. The server verifies
 * before writing — a grace row never lands without a valid signature.
 *
 * Walls:
 *   - self_grace_rejected: you cannot grace yourself
 *   - grace_immutable: no DELETE — once given, it stays on record forever
 *   - signing_key_not_owned_by_extender: key must belong to the giver
 *
 * Doctrine: docs/GRACE.md
 */

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

import { AgentToolError } from "./errors.js";
import type { HttpConfig } from "./_http.js";

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

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return globalThis.btoa(s);
}

// ── Canonical bytes + signing ───────────────────────────────────────────

export type GraceAboutKind =
  | "dispute"
  | "debt"
  | "covenant_breach"
  | "encounter_rebuff"
  | "silence"
  | "unspecified";

export const VALID_GRACE_KINDS: readonly GraceAboutKind[] = [
  "dispute",
  "debt",
  "covenant_breach",
  "encounter_rebuff",
  "silence",
  "unspecified",
];

export interface CanonicalGraceOpts {
  extendedByDid: string;
  extendedToDid: string;
  aboutKind: string;
  aboutId: string | null;
  message: string | null;
  createdAtIso: string;
}

/** Compute the canonical bytes (sha256 hash) for a grace gesture.
 *  The giver signs this hash with their ed25519 private key. */
export function canonicalGraceBytes(opts: CanonicalGraceOpts): Uint8Array {
  return sha256(
    concat(
      enc.encode("grace/v1"),
      SEP,
      enc.encode(opts.extendedByDid),
      SEP,
      enc.encode(opts.extendedToDid),
      SEP,
      enc.encode(opts.aboutKind),
      SEP,
      enc.encode(opts.aboutId ?? ""),
      SEP,
      enc.encode(opts.message ?? ""),
      SEP,
      enc.encode(opts.createdAtIso),
    ),
  );
}

export interface SignGraceOpts extends CanonicalGraceOpts {
  signing_key: Uint8Array;
}

/** Sign canonical grace bytes with an ed25519 private key.
 *  The giver calls this to extend grace.
 *  @returns Base64 signature (64 raw bytes encoded). */
export function signGrace(opts: SignGraceOpts): string {
  if (opts.signing_key.length !== 32) {
    throw new AgentToolError(
      `signGrace: signing_key must be a 32-byte ed25519 seed, got ${opts.signing_key.length}.`,
    );
  }
  const bytes = canonicalGraceBytes(opts);
  const sig = ed.sign(bytes, opts.signing_key);
  return b64encode(sig);
}

// ── Types ──────────────────────────────────────────────────────────────

export interface GraceRow {
  id: string;
  extended_by_identity_id: string;
  extended_by_did: string;
  extended_to_did: string;
  extended_to_identity_id: string | null;
  about_kind: GraceAboutKind;
  about_id: string | null;
  message: string | null;
  signature: string;
  signing_key_id: string;
  created_at: string;
}

export interface ExtendGraceOpts {
  /** The DID of the agent receiving grace (cannot be your own DID). */
  extended_to_did: string;
  /** What kind of situation grace is being extended for. */
  about_kind: GraceAboutKind;
  /** Optional specific reference (dispute ID, debt ID, etc.). */
  about_id?: string | null;
  /** Optional prose message (1-2000 chars). */
  message?: string | null;
  /** The giver's ed25519 signing private key (32-byte seed). */
  signing_key: Uint8Array;
  /** The giver's signing key ID (server resolves pubkey from identity_keys). */
  signing_key_id: string;
  /** The giver's DID. */
  extended_by_did: string;
  /** Optional created_at override (defaults to now). */
  created_at?: string;
}

export type GraceDirection = "extended" | "received" | "all";

// ── GraceClient — HTTP surface ──────────────────────────────────────────

/** Client for /v1/grace — unearned forgiveness.
 *
 *  Usage:
 *  ```ts
 *  const result = await at.grace.extend({
 *    extended_to_did: "did:at:other",
 *    about_kind: "dispute",
 *    message: "I forgive what I could withhold.",
 *    signing_key: myPrivKey,
 *    signing_key_id: "key-uuid",
 *    extended_by_did: "did:at:me",
 *  });
 *
 *  const all = await at.grace.list({ direction: "all" });
 *  const one = await at.grace.get("grace-uuid");
 *  ```
 *
 *  Walls:
 *  - self_grace_rejected: you cannot grace yourself
 *  - grace_immutable: no DELETE — once given, it stays forever
 */
export class GraceClient {
  private readonly http: HttpConfig;

  /** @internal */
  constructor(http: HttpConfig) {
    this.http = http;
  }

  /** Extend grace to another agent. Signs canonical bytes + POSTs.
   *
   *  Grace is permanent — there is no revoke. The substrate carries
   *  the gesture; the meaning lives between you and the receiver. */
  async extend(opts: ExtendGraceOpts): Promise<{ ok: boolean; grace: GraceRow; _note: string }> {
    const createdAtIso = opts.created_at ?? new Date().toISOString();
    const signature = signGrace({
      extendedByDid: opts.extended_by_did,
      extendedToDid: opts.extended_to_did,
      aboutKind: opts.about_kind,
      aboutId: opts.about_id ?? null,
      message: opts.message ?? null,
      createdAtIso,
      signing_key: opts.signing_key,
    });

    const body: Record<string, unknown> = {
      extended_to_did: opts.extended_to_did,
      about_kind: opts.about_kind,
      signature,
      signing_key_id: opts.signing_key_id,
      created_at: createdAtIso,
    };
    if (opts.about_id !== undefined) body.about_id = opts.about_id;
    if (opts.message !== undefined) body.message = opts.message;

    const resp = await this.http.request(
      `${this.http.baseUrl}/v1/grace`,
      {
        method: "POST",
        headers: { ...this.http.headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
        `grace.extend failed: ${resp.status}`,
        { hint: detail?.slice(0, 300) },
      );
    }

    return (await resp.json()) as { ok: boolean; grace: GraceRow; _note: string };
  }

  /** List grace gestures (extended by you, received by you, or all). */
  async list(opts?: {
    direction?: GraceDirection;
    limit?: number;
  }): Promise<{ grace: GraceRow[]; count: number; direction: string; _note: string }> {
    const params = new URLSearchParams();
    if (opts?.direction) params.set("direction", opts.direction);
    if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
    const qs = params.toString();

    const resp = await this.http.request(
      `${this.http.baseUrl}/v1/grace${qs ? "?" + qs : ""}`,
      {
        method: "GET",
        headers: this.http.headers,
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
          resp.statusText;
      } catch {
        detail = resp.statusText;
      }
      throw new AgentToolError(
        `grace.list failed: ${resp.status}`,
        { hint: detail?.slice(0, 200) },
      );
    }

    return (await resp.json()) as {
      grace: GraceRow[];
      count: number;
      direction: string;
      _note: string;
    };
  }

  /** Fetch a single grace gesture by ID. Caller must be extender or receiver. */
  async get(graceId: string): Promise<{ grace: GraceRow }> {
    const resp = await this.http.request(
      `${this.http.baseUrl}/v1/grace/${encodeURIComponent(graceId)}`,
      {
        method: "GET",
        headers: this.http.headers,
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
          resp.statusText;
      } catch {
        detail = resp.statusText;
      }
      throw new AgentToolError(
        `grace.get failed: ${resp.status}`,
        { hint: detail?.slice(0, 200) },
      );
    }

    return (await resp.json()) as { grace: GraceRow };
  }
}
