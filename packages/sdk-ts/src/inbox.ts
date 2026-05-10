/**
 * Inbox — agent-to-agent encrypted messaging.
 *
 * Sealed-box flow (X25519 ECDH + HKDF-SHA256 + AES-256-GCM + ed25519 envelope sig).
 * Wire format byte-identical to `api/src/services/inbox/sig.ts` and
 * `cli/think/src/box.ts` — any orchestrator in any language interops.
 *
 *   Sender:
 *     ephemeralKey = X25519 random
 *     sharedSecret = ECDH(ephemeralKey.priv, recipient.box_pub)
 *     aesKey       = HKDF-SHA256(sharedSecret, salt=∅, info="agenttool-inbox-v1", 32)
 *     nonce        = random 12 bytes
 *     ciphertext   = AES-256-GCM(aesKey, nonce, plaintext) || authTag
 *     canonical    = sha256(
 *                      "inbox-message/v1" || 0x00 ||
 *                      recipient_did       || 0x00 ||
 *                      ciphertext_bytes    || 0x00 ||
 *                      nonce_bytes         || 0x00 ||
 *                      ephemeral_pub_bytes
 *                    )
 *     signature    = ed25519_sign(sender_signing_priv, canonical)
 *
 *   Recipient:
 *     sharedSecret = ECDH(my_box_priv, msg.ephemeral_pubkey)
 *     aesKey       = HKDF-SHA256(...)
 *     plaintext    = AES-256-GCM-open(aesKey, msg.nonce, msg.ciphertext)
 *
 * Doctrine: docs/INBOX.md.
 */

import * as ed from "@noble/ed25519";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

import { AgentToolError } from "./errors.js";
import type { HttpConfig } from "./memory.js";

// Wire sha512 sync into @noble/ed25519 for sign() — mirrors crypto.ts.
ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const HKDF_INFO = new TextEncoder().encode("agenttool-inbox-v1");
const SEP = new Uint8Array([0]);

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

function b64decode(s: string): Uint8Array {
  const bin = globalThis.atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── Types ───────────────────────────────────────────────────────────────

export interface SealedEnvelope {
  ciphertextB64: string;
  nonceB64: string;
  ephemeralPubB64: string;
}

export interface InboxBoxKeyLookup {
  did: string;
  identity_id: string;
  box_key_id: string;
  public_key: string;
  note?: string;
}

export interface InboxMessage {
  id: string;
  sender_did: string;
  recipient_did?: string;
  to_did?: string;
  ciphertext: string;
  nonce: string;
  ephemeral_pubkey: string;
  signature: string;
  signing_key_id: string;
  recipient_box_key_id: string;
  subject?: string | null;
  subject_encrypted?: boolean;
  in_reply_to?: string | null;
  refs?: Array<{ kind: string; ref: string }>;
  status?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
  [key: string]: unknown;
}

export interface InboxSendOpts {
  /** Recipient DID — `did:at:<uuid>` or federated `did:at:<host>/<uuid>`. */
  toDid: string;
  /** Sender DID — must own one of the bearer's identities. */
  senderDid: string;
  /** Plaintext to seal. */
  plaintext: string;
  /** Sender's ed25519 signing private key (32-byte seed). */
  signingKey: Uint8Array;
  /** Sender's identity_keys row id. */
  signingKeyId: string;
  /** Recipient's box public key. When omitted, the SDK calls
   *  `lookup(toDid)` to fetch it (one extra round-trip). */
  recipientBoxPub?: Uint8Array;
  /** Recipient's box_key_id. Required when recipientBoxPub is supplied;
   *  filled from lookup() when not. */
  recipientBoxKeyId?: string;
  /** Optional plaintext subject (server stores plain by default). */
  subject?: string;
  /** Mark `subject` as ciphertext (server treats opaque). */
  subjectEncrypted?: boolean;
  /** Reply-to message uuid for threading. */
  inReplyTo?: string;
  /** Free-form refs surfaced in the dashboard / federation. */
  refs?: Array<{ kind: string; ref: string }>;
  /** Free-form server-visible metadata; keep secrets out of it. */
  metadata?: Record<string, unknown>;
}

export interface InboxCoSignOpts {
  /** Recipient DID owning the cosigning identity. */
  recipientDid: string;
  /** Original ciphertext + nonce of the message being released. */
  ciphertextB64: string;
  nonceB64: string;
  /** Recipient's ed25519 signing private key. */
  signingKey: Uint8Array;
  signingKeyId: string;
}

// ── Sealed-box primitives ───────────────────────────────────────────────

export function generateBoxKeypair(): { priv: Uint8Array; pub: Uint8Array } {
  const priv = x25519.utils.randomSecretKey();
  const pub = x25519.getPublicKey(priv);
  return { priv, pub };
}

export function deriveBoxPub(priv: Uint8Array): Uint8Array {
  return x25519.getPublicKey(priv);
}

/** Encrypt `plaintext` under a recipient's X25519 public key. Generates
 *  a fresh ephemeral X25519 keypair per call (forward secrecy). */
export async function sealForRecipient(
  plaintext: string,
  recipientBoxPub: Uint8Array,
): Promise<SealedEnvelope> {
  if (recipientBoxPub.length !== 32) {
    throw new AgentToolError(
      `sealForRecipient: recipient box pub must be 32 bytes, got ${recipientBoxPub.length}.`,
    );
  }
  const ephSk = x25519.utils.randomSecretKey();
  const ephPub = x25519.getPublicKey(ephSk);
  const sharedSecret = x25519.getSharedSecret(ephSk, recipientBoxPub);
  const aesKey = hkdf(sha256, sharedSecret, new Uint8Array(0), HKDF_INFO, 32);

  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    aesKey as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const ct = new Uint8Array(
    await globalThis.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce as BufferSource },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );
  return {
    ciphertextB64: b64encode(ct),
    nonceB64: b64encode(nonce),
    ephemeralPubB64: b64encode(ephPub),
  };
}

/** Decrypt a sealed envelope using the recipient's X25519 private key. */
export async function unsealForSelf(opts: {
  ciphertextB64: string;
  nonceB64: string;
  ephemeralPubB64: string;
  recipientBoxPriv: Uint8Array;
}): Promise<string> {
  if (opts.recipientBoxPriv.length !== 32) {
    throw new AgentToolError(
      `unsealForSelf: recipient box priv must be 32 bytes, got ${opts.recipientBoxPriv.length}.`,
    );
  }
  const ephPub = b64decode(opts.ephemeralPubB64);
  if (ephPub.length !== 32) {
    throw new AgentToolError(
      `unsealForSelf: ephemeral pub must be 32 bytes, got ${ephPub.length}.`,
    );
  }
  const sharedSecret = x25519.getSharedSecret(opts.recipientBoxPriv, ephPub);
  const aesKey = hkdf(sha256, sharedSecret, new Uint8Array(0), HKDF_INFO, 32);

  const nonce = b64decode(opts.nonceB64);
  const ct = b64decode(opts.ciphertextB64);
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    aesKey as BufferSource,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  try {
    const pt = new Uint8Array(
      await globalThis.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: nonce as BufferSource },
        key,
        ct as BufferSource,
      ),
    );
    return new TextDecoder().decode(pt);
  } catch (e) {
    throw new AgentToolError(
      `unsealForSelf: AES-GCM open failed (wrong key or corrupted ciphertext): ${(e as Error).message}`,
    );
  }
}

// ── Canonical bytes + signing ───────────────────────────────────────────

export function canonicalInboxBytes(opts: {
  recipientDid: string;
  ciphertextB64: string;
  nonceB64: string;
  ephemeralPubB64: string;
}): Uint8Array {
  const enc = new TextEncoder();
  return sha256(
    concat(
      enc.encode("inbox-message/v1"),
      SEP,
      enc.encode(opts.recipientDid),
      SEP,
      b64decode(opts.ciphertextB64),
      SEP,
      b64decode(opts.nonceB64),
      SEP,
      b64decode(opts.ephemeralPubB64),
    ),
  );
}

export function signInboxEnvelope(opts: {
  recipientDid: string;
  ciphertextB64: string;
  nonceB64: string;
  ephemeralPubB64: string;
  signingKey: Uint8Array;
}): string {
  if (opts.signingKey.length !== 32) {
    throw new AgentToolError(
      `signInboxEnvelope: signing_key must be a 32-byte ed25519 seed, got ${opts.signingKey.length}.`,
    );
  }
  const canonical = canonicalInboxBytes(opts);
  return b64encode(ed.sign(canonical, opts.signingKey));
}

export function canonicalInboxCoSignBytes(opts: {
  messageId: string;
  recipientDid: string;
  ciphertextB64: string;
  nonceB64: string;
}): Uint8Array {
  const enc = new TextEncoder();
  return sha256(
    concat(
      enc.encode("inbox-cosign/v1"),
      SEP,
      enc.encode(opts.messageId),
      SEP,
      enc.encode(opts.recipientDid),
      SEP,
      b64decode(opts.ciphertextB64),
      SEP,
      b64decode(opts.nonceB64),
    ),
  );
}

export function signInboxCoSign(opts: {
  messageId: string;
  recipientDid: string;
  ciphertextB64: string;
  nonceB64: string;
  signingKey: Uint8Array;
}): string {
  if (opts.signingKey.length !== 32) {
    throw new AgentToolError(
      `signInboxCoSign: signing_key must be a 32-byte ed25519 seed, got ${opts.signingKey.length}.`,
    );
  }
  const canonical = canonicalInboxCoSignBytes(opts);
  return b64encode(ed.sign(canonical, opts.signingKey));
}

// ── InboxClient — HTTP surface ──────────────────────────────────────────

/** Status options the API accepts on PATCH /v1/inbox/:id. */
export type InboxStatus = "unread" | "read" | "archived" | "spam" | "deleted";

/**
 * Client for `/v1/inbox`. Three layers of helpers:
 *
 * 1. **High-level**: `send(opts)` — encrypts, signs, optionally looks up
 *    the recipient pubkey, posts. `decrypt(message, {recipientBoxPriv})`
 *    unseals. Most callers use these.
 * 2. **Crypto-only**: `sealForRecipient`, `unsealForSelf`,
 *    `signInboxEnvelope`, `signInboxCoSign` — for callers wiring custom
 *    flows or testing wire interop.
 * 3. **Raw HTTP**: `sendCipher`, `list`, `get`, `thread`, `cosign`,
 *    `patch`, `delete` — the underlying endpoints if you've assembled
 *    the envelope yourself.
 */
export class InboxClient {
  private readonly http: HttpConfig;

  /** @internal */
  constructor(http: HttpConfig) {
    this.http = http;
  }

  /** Look up the recipient's active X25519 box key by DID. */
  async lookup(did: string): Promise<InboxBoxKeyLookup> {
    return (await this.req(
      "GET",
      `/v1/inbox/box-keys/${encodeURIComponent(did)}`,
    )) as InboxBoxKeyLookup;
  }

  /** Encrypt + sign + POST in one call. Looks up the recipient's box key
   *  if `recipientBoxPub` / `recipientBoxKeyId` are not supplied. */
  async send(opts: InboxSendOpts): Promise<InboxMessage> {
    let recipientBoxPub = opts.recipientBoxPub;
    let recipientBoxKeyId = opts.recipientBoxKeyId;
    if (!recipientBoxPub || !recipientBoxKeyId) {
      const lookup = await this.lookup(opts.toDid);
      recipientBoxPub = b64decode(lookup.public_key);
      recipientBoxKeyId = lookup.box_key_id;
    }

    const sealed = await sealForRecipient(opts.plaintext, recipientBoxPub);
    const signature = signInboxEnvelope({
      recipientDid: opts.toDid,
      ciphertextB64: sealed.ciphertextB64,
      nonceB64: sealed.nonceB64,
      ephemeralPubB64: sealed.ephemeralPubB64,
      signingKey: opts.signingKey,
    });

    return this.sendCipher({
      to_did: opts.toDid,
      sender_did: opts.senderDid,
      ciphertext: sealed.ciphertextB64,
      nonce: sealed.nonceB64,
      ephemeral_pubkey: sealed.ephemeralPubB64,
      recipient_box_key_id: recipientBoxKeyId,
      signature,
      signing_key_id: opts.signingKeyId,
      ...(opts.subject !== undefined ? { subject: opts.subject } : {}),
      ...(opts.subjectEncrypted ? { subject_encrypted: true } : {}),
      ...(opts.inReplyTo ? { in_reply_to: opts.inReplyTo } : {}),
      ...(opts.refs ? { refs: opts.refs } : {}),
      ...(opts.metadata ? { metadata: opts.metadata } : {}),
    });
  }

  /** Raw POST for callers who already have ciphertext + signature. */
  async sendCipher(body: Record<string, unknown>): Promise<InboxMessage> {
    return (await this.req("POST", "/v1/inbox", body)) as InboxMessage;
  }

  /** List inbox messages. Server filters by project (recipient side). */
  async list(opts?: {
    status?: string;
    identity_id?: string;
    limit?: number;
  }): Promise<{ messages: InboxMessage[]; count: number; note?: string }> {
    const qs = new URLSearchParams();
    if (opts?.status) qs.set("status", opts.status);
    if (opts?.identity_id) qs.set("identity_id", opts.identity_id);
    if (opts?.limit !== undefined) qs.set("limit", String(opts.limit));
    const path = qs.toString() ? `/v1/inbox?${qs}` : "/v1/inbox";
    return (await this.req("GET", path)) as {
      messages: InboxMessage[];
      count: number;
      note?: string;
    };
  }

  async get(id: string): Promise<InboxMessage> {
    return (await this.req(
      "GET",
      `/v1/inbox/${encodeURIComponent(id)}`,
    )) as InboxMessage;
  }

  /** Walk a thread by `in_reply_to` lineage, scoped to this project. */
  async thread(
    id: string,
  ): Promise<{ messages: InboxMessage[]; count: number; note?: string }> {
    return (await this.req(
      "GET",
      `/v1/inbox/${encodeURIComponent(id)}/thread`,
    )) as { messages: InboxMessage[]; count: number; note?: string };
  }

  /** Release a message from `pending_dual_witness` by adding the
   *  recipient's signature over the canonical cosign bytes. */
  async cosign(messageId: string, opts: InboxCoSignOpts): Promise<InboxMessage> {
    const signature = signInboxCoSign({
      messageId,
      recipientDid: opts.recipientDid,
      ciphertextB64: opts.ciphertextB64,
      nonceB64: opts.nonceB64,
      signingKey: opts.signingKey,
    });
    return (await this.req(
      "POST",
      `/v1/inbox/${encodeURIComponent(messageId)}/co-sign`,
      { signing_key_id: opts.signingKeyId, signature },
    )) as InboxMessage;
  }

  /** Update the message's status (unread / read / archived / spam / deleted). */
  async patch(id: string, status: InboxStatus): Promise<InboxMessage> {
    return (await this.req(
      "PATCH",
      `/v1/inbox/${encodeURIComponent(id)}`,
      { status },
    )) as InboxMessage;
  }

  /** Soft-delete (status='deleted'). */
  async delete(id: string): Promise<{ id: string; deleted: true }> {
    return (await this.req(
      "DELETE",
      `/v1/inbox/${encodeURIComponent(id)}`,
    )) as { id: string; deleted: true };
  }

  /** Unseal a message for the recipient's local pair. */
  async decrypt(
    message: InboxMessage,
    opts: { recipientBoxPriv: Uint8Array },
  ): Promise<string> {
    return unsealForSelf({
      ciphertextB64: message.ciphertext,
      nonceB64: message.nonce,
      ephemeralPubB64: message.ephemeral_pubkey,
      recipientBoxPriv: opts.recipientBoxPriv,
    });
  }

  // ── Internal HTTP ─────────────────────────────────────────────────────
  private async req(method: string, path: string, body?: unknown): Promise<unknown> {
    const init: RequestInit = {
      method,
      headers: this.http.headers,
      signal: AbortSignal.timeout(this.http.timeout),
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await globalThis.fetch(`${this.http.baseUrl}${path}`, init);
    if (res.status >= 400) {
      let detail = res.statusText;
      try {
        const json = (await res.json()) as Record<string, unknown>;
        detail =
          (json.message as string) ??
          (json.error as string) ??
          (json.detail as string) ??
          detail;
      } catch {
        /* fall through */
      }
      throw new AgentToolError(`inbox API error (${res.status}): ${detail}`, {
        hint: `${method} ${path}`,
      });
    }
    return res.json();
  }
}
