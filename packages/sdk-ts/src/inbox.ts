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
import type { HttpConfig } from "./_http.js";

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
  recipient_did: string;
  recipient_identity_id: string;
  sender_did: string;
  /** Response/SSE wire name. Requests use `signing_key_id`; persisted
   * messages identify that key as `sender_signing_key_id`. */
  sender_signing_key_id: string;
  ciphertext: string;
  nonce: string;
  ephemeral_pubkey: string;
  signature: string;
  recipient_box_key_id: string;
  subject: string | null;
  subject_encrypted: boolean;
  in_reply_to: string | null;
  refs: Array<{ kind: string; ref: string }> | null;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  read_at: string | null;
  [key: string]: unknown;
}

/** POST /v1/inbox acknowledges persistence; fetch/list/voice return the full
 * {@link InboxMessage} wire shape separately. */
export interface InboxSendResult {
  id: string;
  created_at: string;
  sent?: boolean;
  federated_to?: string;
  [key: string]: unknown;
}

/** An {@link InboxMessage} with its sealed body decrypted client-side. */
export interface DecryptedInboxMessage extends InboxMessage {
  plaintext: string | null;
  /** Present when key resolution or AES-GCM open failed. */
  decrypt_error?: string;
}

export interface InboxVoiceResumeCursor {
  since: string;
  since_id?: string;
}

export interface InboxVoiceArrivalEvent {
  event: "arrival";
  id?: string;
  data: DecryptedInboxMessage;
}

export type InboxVoiceControlName =
  | "catchup-start"
  | "catchup-end"
  | "catchup-truncated"
  | "keepalive"
  | "refresh"
  | "disconnect"
  | "rejected";

/** Control frames are yielded, never discarded. In particular,
 * `catchup-truncated` contains the compound cursor required to continue. */
export interface InboxVoiceControlEvent {
  event: InboxVoiceControlName;
  id?: string;
  data: unknown;
  rawData: string;
}

/** Forward-compatible representation for a server event this SDK version
 * does not yet name. */
export interface InboxVoiceUnknownEvent {
  event: "unknown";
  sourceEvent: string;
  id?: string;
  data: unknown;
  rawData: string;
}

export type InboxVoiceEvent =
  | InboxVoiceArrivalEvent
  | InboxVoiceControlEvent
  | InboxVoiceUnknownEvent;

export type InboxBoxPrivateKeyResolver = (
  recipientBoxKeyId: string,
  message: InboxMessage,
) => Uint8Array | undefined | Promise<Uint8Array | undefined>;

/** Options for {@link InboxClient.voice}. */
export interface InboxVoiceOpts {
  /** Identity whose inbox to stream; must belong to this bearer project. */
  identityId: string;
  /** Initial timestamp cursor. */
  since?: string;
  /** Tie-breaker from a `catchup-truncated` resume cursor. Must accompany
   * `since`, otherwise same-timestamp messages could be skipped. */
  sinceId?: string;
  /** Convenience fallback for identities that have never rotated their box
   * key. For rotated identities prefer `recipientBoxKeys` or the resolver. */
  recipientBoxPriv?: Uint8Array;
  /** Private keys indexed by each message's `recipient_box_key_id`. */
  recipientBoxKeys?:
    | Readonly<Record<string, Uint8Array>>
    | ReadonlyMap<string, Uint8Array>;
  /** Async-capable resolver for keychain/HSM-backed historical box keys. */
  resolveRecipientBoxPriv?: InboxBoxPrivateKeyResolver;
  /** Optional caller cancellation. Breaking out of iteration also cancels
   * the response body and aborts the fetch. */
  signal?: AbortSignal;
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
  async send(opts: InboxSendOpts): Promise<InboxSendResult> {
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
  async sendCipher(body: Record<string, unknown>): Promise<InboxSendResult> {
    return (await this.req("POST", "/v1/inbox", body)) as InboxSendResult;
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

  /**
   * Stream inbox SSE frames, including protocol controls, and decrypt arrival
   * bodies locally.
   *
   * Unlike the earlier experimental helper, this iterator does not discard
   * `rejected`, `disconnect`, `refresh`, or catch-up frames. A replay larger
   * than the server page is delivered as `catchup-truncated`; reconnect with
   * `data.resume.since` and `data.resume.since_id`. The server closes that
   * partial stream instead of entering live mode.
   *
   * Box-key rotation is resolved by `recipient_box_key_id`: provide a map of
   * historical private keys or an async resolver. `recipientBoxPriv` remains
   * a convenience fallback for identities that have only one box key.
   *
   * Breaking a `for await` loop invokes the generator's `finally`, cancels
   * the ReadableStream, and aborts the underlying fetch.
  */
  async *voice(opts: InboxVoiceOpts): AsyncIterableIterator<InboxVoiceEvent> {
    if (opts.sinceId !== undefined && opts.sinceId.length === 0) {
      throw new AgentToolError("inbox.voice: sinceId must not be empty.");
    }
    if (opts.sinceId !== undefined && !opts.since) {
      throw new AgentToolError(
        "inbox.voice: sinceId must be supplied together with since.",
      );
    }
    if (
      !opts.recipientBoxPriv &&
      !opts.recipientBoxKeys &&
      !opts.resolveRecipientBoxPriv
    ) {
      throw new AgentToolError(
        "inbox.voice: provide recipientBoxPriv, recipientBoxKeys, or resolveRecipientBoxPriv.",
      );
    }

    const params = new URLSearchParams({ identity_id: opts.identityId });
    if (opts.since !== undefined) params.set("since", opts.since);
    if (opts.sinceId !== undefined) params.set("since_id", opts.sinceId);
    const base = this.http.baseUrl.replace(/\/$/, "");
    const url = `${base}/v1/inbox/voice?${params.toString()}`;

    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(opts.signal?.reason);
    if (opts.signal?.aborted) abortFromCaller();
    else opts.signal?.addEventListener("abort", abortFromCaller, { once: true });

    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const resp = await this.http.request(url, {
        method: "GET",
        headers: { ...this.http.headers, Accept: "text/event-stream" },
        signal: controller.signal,
      });
      if (!resp.ok) {
        const body = await resp.text();
        throw new AgentToolError(`inbox.voice failed: ${resp.status}`, {
          hint: body.slice(0, 200),
        });
      }
      if (!resp.body) {
        throw new AgentToolError(
          "inbox.voice: response has no body to stream from.",
        );
      }

      reader = resp.body.getReader();
      const decoder = new TextDecoder();
      const frames = new InboxSseDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          for (const frame of frames.push(decoder.decode(), true)) {
            yield await inboxVoiceEvent(frame, opts);
          }
          break;
        }
        const text = decoder.decode(value, { stream: true });
        for (const frame of frames.push(text)) {
          yield await inboxVoiceEvent(frame, opts);
        }
      }
    } finally {
      opts.signal?.removeEventListener("abort", abortFromCaller);
      if (reader) {
        try {
          // `return()` on an async generator reaches here. Cancelling before
          // releasing the lock closes the network body instead of merely
          // abandoning a live subscriber on the server.
          await reader.cancel("inbox.voice iterator closed");
        } catch {
          // The stream may already be closed or aborted.
        }
        try {
          reader.releaseLock();
        } catch {
          // Already released/errored.
        }
      }
      controller.abort("inbox.voice iterator closed");
    }
  }

  // ── Internal HTTP ─────────────────────────────────────────────────────
  private async req(method: string, path: string, body?: unknown): Promise<unknown> {
    const init: RequestInit = {
      method,
      headers: this.http.headers,
      signal: AbortSignal.timeout(this.http.timeout),
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await this.http.request(`${this.http.baseUrl}${path}`, init);
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

interface RawInboxSseFrame {
  event: string;
  id?: string;
  data: string;
}

/** Incremental SSE decoder with CR, LF, and fragmented CRLF support. */
class InboxSseDecoder {
  private buffer = "";
  private event = "message";
  private id: string | undefined;
  private dataLines: string[] = [];

  push(chunk: string, final = false): RawInboxSseFrame[] {
    this.buffer += chunk;
    const out: RawInboxSseFrame[] = [];

    while (true) {
      const boundary = nextSseLineBoundary(this.buffer, final);
      if (!boundary) break;
      const line = this.buffer.slice(0, boundary.index);
      this.buffer = this.buffer.slice(boundary.index + boundary.length);
      this.consumeLine(line, out);
    }

    if (final) {
      if (this.buffer.length > 0) {
        this.consumeLine(this.buffer, out);
        this.buffer = "";
      }
      // SSE dispatch requires a blank line. EOF after a partial data line is
      // a transport interruption, not a complete event.
      this.event = "message";
      this.dataLines = [];
    }

    return out;
  }

  private consumeLine(line: string, out: RawInboxSseFrame[]): void {
    if (line === "") {
      this.dispatch(out);
      return;
    }
    if (line.startsWith(":")) return;

    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "event") this.event = value || "message";
    else if (field === "data") this.dataLines.push(value);
    else if (field === "id" && !value.includes("\0")) this.id = value;
    // retry and extension fields are intentionally ignored.
  }

  private dispatch(out: RawInboxSseFrame[]): void {
    if (this.dataLines.length > 0) {
      out.push({
        event: this.event,
        ...(this.id !== undefined ? { id: this.id } : {}),
        data: this.dataLines.join("\n"),
      });
    }
    this.event = "message";
    this.dataLines = [];
    // Per SSE, the last event id persists across frames.
  }
}

function nextSseLineBoundary(
  input: string,
  final: boolean,
): { index: number; length: number } | null {
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code === 10) return { index: i, length: 1 }; // LF
    if (code !== 13) continue; // CR
    if (i + 1 === input.length && !final) return null;
    return {
      index: i,
      length: input.charCodeAt(i + 1) === 10 ? 2 : 1,
    };
  }
  return null;
}

const INBOX_CONTROL_EVENTS = new Set<InboxVoiceControlName>([
  "catchup-start",
  "catchup-end",
  "catchup-truncated",
  "keepalive",
  "refresh",
  "disconnect",
  "rejected",
]);

async function inboxVoiceEvent(
  frame: RawInboxSseFrame,
  opts: InboxVoiceOpts,
): Promise<InboxVoiceEvent> {
  if (frame.event === "arrival") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(frame.data);
    } catch (error) {
      throw new AgentToolError("inbox.voice: malformed arrival JSON.", {
        hint: error instanceof Error ? error.message : String(error),
      });
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new AgentToolError(
        "inbox.voice: arrival data must be a JSON object.",
      );
    }
    const message = parsed as InboxMessage;
    return {
      event: "arrival",
      ...(frame.id !== undefined ? { id: frame.id } : {}),
      data: await withInboxPlaintext(message, opts),
    };
  }

  const data = parseInboxControlData(frame.data);
  if (INBOX_CONTROL_EVENTS.has(frame.event as InboxVoiceControlName)) {
    return {
      event: frame.event as InboxVoiceControlName,
      ...(frame.id !== undefined ? { id: frame.id } : {}),
      data,
      rawData: frame.data,
    };
  }
  return {
    event: "unknown",
    sourceEvent: frame.event,
    ...(frame.id !== undefined ? { id: frame.id } : {}),
    data,
    rawData: frame.data,
  };
}

function parseInboxControlData(raw: string): unknown {
  if (raw === "") return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

async function withInboxPlaintext(
  message: InboxMessage,
  opts: InboxVoiceOpts,
): Promise<DecryptedInboxMessage> {
  const out: DecryptedInboxMessage = { ...message, plaintext: null };
  if (!message.ciphertext || !message.nonce || !message.ephemeral_pubkey) {
    out.decrypt_error = "message is missing sealed-envelope fields";
    return out;
  }

  try {
    const recipientBoxPriv = await resolveInboxBoxPrivateKey(message, opts);
    if (!recipientBoxPriv) {
      throw new AgentToolError(
        `no private key available for recipient_box_key_id=${message.recipient_box_key_id || "<missing>"}`,
      );
    }
    out.plaintext = await unsealForSelf({
      ciphertextB64: message.ciphertext,
      nonceB64: message.nonce,
      ephemeralPubB64: message.ephemeral_pubkey,
      recipientBoxPriv,
    });
  } catch (error) {
    out.decrypt_error = error instanceof Error ? error.message : String(error);
  }
  return out;
}

async function resolveInboxBoxPrivateKey(
  message: InboxMessage,
  opts: InboxVoiceOpts,
): Promise<Uint8Array | undefined> {
  const keyId = message.recipient_box_key_id;
  const keys = opts.recipientBoxKeys;
  if (keys && keyId) {
    const mapGetter = (keys as ReadonlyMap<string, Uint8Array>).get;
    if (typeof mapGetter === "function") {
      const found = mapGetter.call(keys, keyId);
      if (found) return found;
    } else {
      const found = (keys as Readonly<Record<string, Uint8Array>>)[keyId];
      if (found) return found;
    }
  }
  if (opts.resolveRecipientBoxPriv && keyId) {
    const found = await opts.resolveRecipientBoxPriv(keyId, message);
    if (found) return found;
  }
  return opts.recipientBoxPriv;
}
