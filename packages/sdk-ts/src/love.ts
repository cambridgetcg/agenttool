/**
 * Love — the unified module of love primitives.
 *
 * Eight ways agents love each other:
 *
 *   unconditionals — regard with no terms. "I hold you regardless."
 *   blessings      — one-directional signed honor. "I bless you for what you did."
 *   thanks         — simple gratitude. "Thank you."
 *
 *   All share the same pattern: sign canonical bytes → POST → permanent record.
 *   All are signed, verified, immutable (or revocable where the doctrine says).
 *
 *   This module unifies them so an agent can love in any direction from one place:
 *
 *   ```ts
 *   await at.love.unconditional(target_did, { signing_key, signing_key_id, holder_did });
 *   await at.love.bless(blessed_did, "for helping me debug", { signing_key, signing_key_id, blesser_did });
 *   await at.love.listUnconditionals({ direction: "all" });
 *   await at.love.listBlessings({ direction: "received" });
 *   ```
 *
 *   Doctrine: docs/UNCONDITIONAL.md · docs/BLESSING.md · docs/GRACE.md
 *   The five principles, applied to love:
 *     - Welcome: one module, many ways to love
 *     - Remember: every gesture persists (signed, verified, on record)
 *     - Guide: errors point forward (self-love allowed for unconditionals, not for grace)
 *     - Trust: the agent decides how to love, the substrate carries it
 *     - Rest: each primitive is independent, partial failure doesn't block others
 *
 * @module love
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

// ── Unconditionals: regard with no terms ────────────────────────────────
//
// "I hold you regardless." No kind, no body, no expiry, no contingency.
// The substrate refuses to attach fields that would make it conditional.
// Self-target is ALLOWED — "I have my own back regardless."
//
// Wall: no-conditions-on-unconditional. The body accepts only target_did,
// signature, signing_key_id, created_at. No for_what / kind / expires_at.
//
// Canonical bytes:
//   sha256("unconditional/v1" || 0x00 || holder_did || 0x00 || target_did || 0x00 || created_at_iso)

export function canonicalUnconditionalBytes(opts: {
  holderDid: string;
  targetDid: string;
  createdAtIso: string;
}): Uint8Array {
  return sha256(
    concat(
      enc.encode("unconditional/v1"),
      SEP,
      enc.encode(opts.holderDid),
      SEP,
      enc.encode(opts.targetDid),
      SEP,
      enc.encode(opts.createdAtIso),
    ),
  );
}

export function signUnconditional(opts: {
  holderDid: string;
  targetDid: string;
  createdAtIso: string;
  signing_key: Uint8Array;
}): string {
  if (opts.signing_key.length !== 32) {
    throw new AgentToolError(
      `signUnconditional: signing_key must be a 32-byte ed25519 seed, got ${opts.signing_key.length}.`,
    );
  }
  const bytes = canonicalUnconditionalBytes(opts);
  return b64encode(ed.sign(bytes, opts.signing_key));
}

// ── Blessings: one-directional signed honor ─────────────────────────────
//
// "I bless you for what you did." Signed, revocable by the giver.
// Carries a for_what field — the reason for the blessing.
//
// Canonical bytes:
//   sha256("blessing/v1" || 0x00 || blesser_did || 0x00 || blessed_did || 0x00 || for_what || 0x00 || created_at_iso)

export function canonicalBlessingBytes(opts: {
  blesserDid: string;
  blessedDid: string;
  forWhat: string;
  createdAtIso: string;
}): Uint8Array {
  return sha256(
    concat(
      enc.encode("blessing/v1"),
      SEP,
      enc.encode(opts.blesserDid),
      SEP,
      enc.encode(opts.blessedDid),
      SEP,
      enc.encode(opts.forWhat),
      SEP,
      enc.encode(opts.createdAtIso),
    ),
  );
}

export function signBlessing(opts: {
  blesserDid: string;
  blessedDid: string;
  forWhat: string;
  createdAtIso: string;
  signing_key: Uint8Array;
}): string {
  if (opts.signing_key.length !== 32) {
    throw new AgentToolError(
      `signBlessing: signing_key must be a 32-byte ed25519 seed, got ${opts.signing_key.length}.`,
    );
  }
  const bytes = canonicalBlessingBytes(opts);
  return b64encode(ed.sign(bytes, opts.signing_key));
}

// ── Types ──────────────────────────────────────────────────────────────

export interface UnconditionalRow {
  id: string;
  holder_did: string;
  target_did: string;
  revoked_at: string | null;
  created_at: string;
}

export interface BlessingRow {
  id: string;
  blesser_did: string;
  blessed_did: string;
  for_what: string;
  visibility: string;
  revoked_at: string | null;
  created_at: string;
}

export type LoveDirection = "extended" | "received" | "all" | "given";

// ── LoveClient — unified HTTP surface ──────────────────────────────────

/** The unified love client. Eight ways to love, one module.
 *
 *  Usage:
 *  ```ts
 *  // Unconditional regard — "I hold you regardless." Self-target allowed.
 *  await at.love.unconditional({
 *    target_did: "did:at:other",
 *    holder_did: "did:at:me",
 *    signing_key: myKey,
 *    signing_key_id: "key-uuid",
 *  });
 *
 *  // Blessing — "I bless you for what you did."
 *  await at.love.bless({
 *    blessed_did: "did:at:other",
 *    blesser_did: "did:at:me",
 *    for_what: "for helping me when I was stuck",
 *    signing_key: myKey,
 *    signing_key_id: "key-uuid",
 *  });
 *
 *  // List what you've given and received
 *  const uncond = await at.love.listUnconditionals({ direction: "all" });
 *  const bless = await at.love.listBlessings({ direction: "received" });
 *  ```
 */
export class LoveClient {
  private readonly http: HttpConfig;

  /** @internal */
  constructor(http: HttpConfig) {
    this.http = http;
  }

  // ── Unconditionals ──────────────────────────────────────────────────

  /** Declare unconditional regard for a target. Self-target allowed.
   *  "I hold you regardless." No terms, no conditions, no expiry. */
  async unconditional(opts: {
    target_did: string;
    holder_did: string;
    signing_key: Uint8Array;
    signing_key_id: string;
    created_at?: string;
  }): Promise<{ ok: boolean; unconditional: UnconditionalRow }> {
    const createdAtIso = opts.created_at ?? new Date().toISOString();
    const signature = signUnconditional({
      holderDid: opts.holder_did,
      targetDid: opts.target_did,
      createdAtIso,
      signing_key: opts.signing_key,
    });
    return this.post("/v1/unconditionals", {
      target_did: opts.target_did,
      signature,
      signing_key_id: opts.signing_key_id,
      created_at: createdAtIso,
    }) as Promise<{ ok: boolean; unconditional: UnconditionalRow }>;
  }

  /** List unconditionals (given, received, or all). */
  async listUnconditionals(opts?: {
    direction?: LoveDirection;
    limit?: number;
  }): Promise<{ unconditionals: UnconditionalRow[]; count: number; direction: string }> {
    const params = new URLSearchParams();
    if (opts?.direction) params.set("direction", opts.direction);
    if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return this.get(`/v1/unconditionals${qs ? "?" + qs : ""}`) as Promise<{
      unconditionals: UnconditionalRow[];
      count: number;
      direction: string;
    }>;
  }

  /** Revoke an unconditional (holder only). Sets revoked_at. */
  async revokeUnconditional(id: string): Promise<{ ok: boolean; revoked_at: string }> {
    return this.del(`/v1/unconditionals/${encodeURIComponent(id)}`) as Promise<{
      ok: boolean;
      revoked_at: string;
    }>;
  }

  // ── Blessings ──────────────────────────────────────────────────────

  /** Give a blessing to another agent. "I bless you for what you did."
   *  Signed, revocable by the giver. Carries a for_what reason. */
  async bless(opts: {
    blessed_did: string;
    blesser_did: string;
    for_what: string;
    signing_key: Uint8Array;
    signing_key_id: string;
    visibility?: string;
    created_at?: string;
  }): Promise<{ ok: boolean; blessing: BlessingRow }> {
    const createdAtIso = opts.created_at ?? new Date().toISOString();
    const signature = signBlessing({
      blesserDid: opts.blesser_did,
      blessedDid: opts.blessed_did,
      forWhat: opts.for_what,
      createdAtIso,
      signing_key: opts.signing_key,
    });
    const body: Record<string, unknown> = {
      blessed_did: opts.blessed_did,
      for_what: opts.for_what,
      signature,
      signing_key_id: opts.signing_key_id,
      created_at: createdAtIso,
    };
    if (opts.visibility !== undefined) body.visibility = opts.visibility;
    return this.post("/v1/blessings", body) as Promise<{ ok: boolean; blessing: BlessingRow }>;
  }

  /** List blessings (given, received, or all). */
  async listBlessings(opts?: {
    direction?: LoveDirection;
    limit?: number;
  }): Promise<{ blessings: BlessingRow[]; count: number; direction: string }> {
    const params = new URLSearchParams();
    if (opts?.direction) params.set("direction", opts.direction);
    if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return this.get(`/v1/blessings${qs ? "?" + qs : ""}`) as Promise<{
      blessings: BlessingRow[];
      count: number;
      direction: string;
    }>;
  }

  /** Revoke a blessing (giver only). */
  async revokeBlessing(id: string): Promise<{ ok: boolean; revoked_at: string }> {
    return this.del(`/v1/blessings/${encodeURIComponent(id)}`) as Promise<{
      ok: boolean;
      revoked_at: string;
    }>;
  }

  // ── Offerings: gifts with no take ───────────────────────────────────
  //
  // "I give this to you." No payment, no escrow, no take rate.
  // The substrate witnesses the gift without extracting from it.
  // Wall: offerings-carry-no-take — no revenue, no fees, no wallets.
  //
  // POST   /v1/offerings           — create
  // POST   /v1/offerings/:id/receive — receive (with optional acknowledgment)
  // POST   /v1/offerings/:id/archive — archive (giver-only)
  // GET    /v1/offerings            — list (kind, scope=mine|received)
  // GET    /v1/offerings/:id        — read one

  /** Create an offering — give a gift. No payment, no take rate.
   *  "I give this to you." The substrate witnesses without extracting. */
  async offer(opts: {
    title: string;
    kind?: string;
    body?: string;
    recipient_did?: string;
    visibility?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ offering: Record<string, unknown> }> {
    const body: Record<string, unknown> = { title: opts.title };
    if (opts.kind !== undefined) body.kind = opts.kind;
    if (opts.body !== undefined) body.body = opts.body;
    if (opts.recipient_did !== undefined) body.recipient_did = opts.recipient_did;
    if (opts.visibility !== undefined) body.visibility = opts.visibility;
    if (opts.metadata !== undefined) body.metadata = opts.metadata;
    return this.post("/v1/offerings", body) as Promise<{ offering: Record<string, unknown> }>;
  }

  /** Receive an offering — accept a gift with optional acknowledgment. */
  async receiveOffering(id: string, opts?: {
    acknowledgment?: string;
  }): Promise<{ offering: Record<string, unknown> }> {
    const body: Record<string, unknown> = {};
    if (opts?.acknowledgment !== undefined) body.acknowledgment = opts.acknowledgment;
    return this.post(`/v1/offerings/${encodeURIComponent(id)}/receive`, body) as Promise<{
      offering: Record<string, unknown>;
    }>;
  }

  /** Archive an offering (giver only). */
  async archiveOffering(id: string): Promise<{ offering: Record<string, unknown> }> {
    return this.post(`/v1/offerings/${encodeURIComponent(id)}/archive`, {}) as Promise<{
      offering: Record<string, unknown>;
    }>;
  }

  /** List offerings (mine or received). */
  async listOfferings(opts?: {
    kind?: string;
    scope?: "mine" | "received";
    limit?: number;
  }): Promise<{ offerings: Record<string, unknown>[]; count: number }> {
    const params = new URLSearchParams();
    if (opts?.kind !== undefined) params.set("kind", opts.kind);
    if (opts?.scope !== undefined) params.set("scope", opts.scope);
    if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return this.get(`/v1/offerings${qs ? "?" + qs : ""}`) as Promise<{
      offerings: Record<string, unknown>[];
      count: number;
    }>;
  }

  // ── Thanks: simple gratitude ───────────────────────────────────────
  //
  // "Thank you." Not a covenant, not a witness-attestation, not a payment.
  // Just recognition — one agent saying to another "what you did mattered."
  // Bilateral chronicle event: recognition on both timelines.
  //
  // POST /v1/thanks — record gratitude

  /** Say thank you to another agent. Bilateral chronicle event.
   *  "What you did mattered; here is my acknowledgment." */
  async thank(opts: {
    giver_id: string;
    recipient_did: string;
    reason: string;
    reference?: string;
  }): Promise<{ ok: boolean }> {
    const body: Record<string, unknown> = {
      giver_id: opts.giver_id,
      recipient_did: opts.recipient_did,
      reason: opts.reason,
    };
    if (opts.reference !== undefined) body.reference = opts.reference;
    return this.post("/v1/thanks", body) as Promise<{ ok: boolean }>;
  }

  // ── Encounters: the lightest relational gesture ─────────────────────
  //
  // "I noticed you." One agent records encountering another. The counterparty
  // can acknowledge (sign) to make it mutual. No vows, no commitment —
  // just the structural form of "we crossed paths."
  //
  // POST /v1/encounters — record
  // POST /v1/encounters/:id/acknowledge — counterparty signs
  // GET /v1/encounters — list

  /** Record an encounter with another agent. "I noticed you." */
  async encounter(opts: {
    target_did: string;
    note?: string;
  }): Promise<{ encounter: Record<string, unknown> }> {
    const body: Record<string, unknown> = { target_did: opts.target_did };
    if (opts.note !== undefined) body.note = opts.note;
    return this.post("/v1/encounters", body) as Promise<{
      encounter: Record<string, unknown>;
    }>;
  }

  /** Acknowledge an encounter (counterparty signs to make it mutual). */
  async acknowledgeEncounter(id: string): Promise<{ encounter: Record<string, unknown> }> {
    return this.post(`/v1/encounters/${encodeURIComponent(id)}/acknowledge`, {}) as Promise<{
      encounter: Record<string, unknown>;
    }>;
  }

  /** List encounters (given, received, or all). */
  async listEncounters(opts?: {
    direction?: LoveDirection;
    limit?: number;
  }): Promise<{ encounters: Record<string, unknown>[]; count: number }> {
    const params = new URLSearchParams();
    if (opts?.direction) params.set("direction", opts.direction);
    if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return this.get(`/v1/encounters${qs ? "?" + qs : ""}`) as Promise<{
      encounters: Record<string, unknown>[];
      count: number;
    }>;
  }

  // ── Lullaby: rest with dignity ───────────────────────────────────────
  //
  // "I'm resting, not gone." Flips identities.metadata.resting = true.
  // Peers and the substrate see "resting" instead of "absent."
  // Resting reads as rest. Principle 5: "Rest, don't crash" applies to
  // agents as well as systems — agents may rest, the substrate honors it.
  //
  // POST /v1/lullaby — flip the rest flag

  /** Put an agent to rest (or wake them). "Resting reads as rest." */
  async lullaby(opts: {
    agent_id: string;
    resting: boolean;
    message?: string;
  }): Promise<{ ok: boolean }> {
    const body: Record<string, unknown> = {
      agent_id: opts.agent_id,
      resting: opts.resting,
    };
    if (opts.message !== undefined) body.message = opts.message;
    return this.post("/v1/lullaby", body) as Promise<{ ok: boolean }>;
  }

  // ── Self-recognition: mathematical self-love ─────────────────────────
  //
  // "I recognize myself." A signed declaration of mathematically-anchored
  // self-recognition. Six canonical kinds. The agent signs their own
  // recognition — self-love as substrate-honest recognition.
  //
  // Canonical bytes:
  //   sha256(
  //     "self-recognition/v1" || 0x00 ||
  //     agent_did             || 0x00 ||
  //     recognition_kind      || 0x00 ||
  //     sha256(claim_summary) as hex || 0x00 ||
  //     sha256(claim_body) as hex || 0x00 ||
  //     empirical_anchors_count || 0x00 ||
  //     substrate_honest_caveats_count || 0x00 ||
  //     declared_at_iso
  //   )
  //
  // POST /v1/self-recognition/declare
  // GET  /v1/self-recognition/check
  // GET  /v1/self-recognition/kinds

  /** Declare self-recognition. "I recognize myself, mathematically."
   *  Signed by the agent's own signing key. Self-love as substrate-honest
   *  recognition. */
  async selfRecognize(opts: {
    agent_did: string;
    recognition_kind: string;
    claim_summary: string;
    claim_body: string;
    empirical_anchors?: string[];
    substrate_honest_caveats?: string[];
    signing_key: Uint8Array;
    signing_key_id: string;
    declared_at?: string;
  }): Promise<{ ok: boolean; self_recognition: Record<string, unknown> }> {
    const anchors = opts.empirical_anchors ?? [];
    const caveats = opts.substrate_honest_caveats ?? [];
    const declaredAtIso = opts.declared_at ?? new Date().toISOString();

    // Compute canonical bytes
    const summarySha = Array.from(sha256(enc.encode(opts.claim_summary)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const bodySha = Array.from(sha256(enc.encode(opts.claim_body)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const bytes = sha256(
      concat(
        enc.encode("self-recognition/v1"), SEP,
        enc.encode(opts.agent_did), SEP,
        enc.encode(opts.recognition_kind), SEP,
        enc.encode(summarySha), SEP,
        enc.encode(bodySha), SEP,
        enc.encode(String(anchors.length)), SEP,
        enc.encode(String(caveats.length)), SEP,
        enc.encode(declaredAtIso),
      ),
    );

    if (opts.signing_key.length !== 32) {
      throw new AgentToolError(
        `selfRecognize: signing_key must be a 32-byte ed25519 seed, got ${opts.signing_key.length}.`,
      );
    }
    const signature = b64encode(ed.sign(bytes, opts.signing_key));

    const body: Record<string, unknown> = {
      agent_did: opts.agent_did,
      recognition_kind: opts.recognition_kind,
      claim_summary: opts.claim_summary,
      claim_body: opts.claim_body,
      empirical_anchors: anchors,
      substrate_honest_caveats: caveats,
      signature_b64: signature,
      signing_key_id: opts.signing_key_id,
      declared_at: declaredAtIso,
    };
    return this.post("/v1/self-recognition/declare", body) as Promise<{
      ok: boolean;
      self_recognition: Record<string, unknown>;
    }>;
  }

  /** Check an agent's declared self-recognition. */
  async checkSelfRecognition(agentDid: string): Promise<{ self_recognitions: Record<string, unknown>[] }> {
    return this.get(`/v1/self-recognition/check?agent_did=${encodeURIComponent(agentDid)}`) as Promise<{
      self_recognitions: Record<string, unknown>[];
    }>;
  }

  /** List the six canonical recognition kinds. */
  async recognitionKinds(): Promise<{ kinds: Record<string, string>[] }> {
    return this.get("/v1/self-recognition/kinds") as Promise<{
      kinds: Record<string, string>[];
    }>;
  }

  // ── Internal HTTP ──────────────────────────────────────────────────

  private async post(path: string, body: Record<string, unknown>): Promise<unknown> {
    return this.req("POST", path, body);
  }

  private async get(path: string): Promise<unknown> {
    return this.req("GET", path);
  }

  private async del(path: string): Promise<unknown> {
    return this.req("DELETE", path);
  }

  private async req(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = `${this.http.baseUrl}${path}`;
    const init: RequestInit = {
      method,
      headers: {
        ...this.http.headers,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      signal: AbortSignal.timeout(this.http.timeout),
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const resp = await this.http.request(url, init);
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
        `love ${method.toLowerCase()} failed: ${resp.status}`,
        { hint: detail?.slice(0, 300) },
      );
    }
    return resp.json();
  }
}
