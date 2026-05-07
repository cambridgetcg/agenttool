/** inbox mode — send / list / read / mark / delete encrypted messages.
 *
 *  agenttool stores ciphertext + sig; we encrypt to recipient's X25519
 *  pubkey here, sign with ed25519, post. Receiving: list → decrypt
 *  locally with our box priv. Server cannot read content.
 *
 *  Doctrine: docs/INBOX.md. */

import { readFileSync } from "node:fs";

import { AgenttoolClient, type InboxMessage } from "../api";
import { sealForRecipient, signInboxEnvelope, unsealForSelf } from "../box";
import type { ThinkConfig } from "../config";
import { requireBoxKey, type KeyMaterial } from "../keys";

// ── TTY-aware rendering ─────────────────────────────────────────────────

const TTY = process.stdout.isTTY === true;
const C = {
  dim: (s: string) => (TTY ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s: string) => (TTY ? `\x1b[1m${s}\x1b[0m` : s),
  cyan: (s: string) => (TTY ? `\x1b[36m${s}\x1b[0m` : s),
  yellow: (s: string) => (TTY ? `\x1b[33m${s}\x1b[0m` : s),
  red: (s: string) => (TTY ? `\x1b[31m${s}\x1b[0m` : s),
  green: (s: string) => (TTY ? `\x1b[32m${s}\x1b[0m` : s),
  magenta: (s: string) => (TTY ? `\x1b[35m${s}\x1b[0m` : s),
};

function fmtTimestamp(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16).replace("T", " ");
}

// ── Helpers ─────────────────────────────────────────────────────────────

/** Resolve our own DID by hitting /v1/wake.
 *  TODO: cache this; for v1 we re-fetch per inbox command. */
async function resolveOwnDid(client: AgenttoolClient, identityId: string): Promise<string> {
  const wake = await client.getWake();
  const me = wake.you.agents.find((a) => a.id === identityId);
  if (!me) {
    throw new Error(
      `identity ${identityId} not found in wake response; check AGENTTOOL_IDENTITY_ID`,
    );
  }
  return me.did;
}

function readBodyFromStdinOrFlag(opts: SendOptions): string {
  if (opts.body !== undefined) return opts.body;
  if (opts.bodyFile) {
    return readFileSync(opts.bodyFile, "utf-8");
  }
  if (process.stdin.isTTY) {
    throw new Error(
      "no body provided. Pass --body 'text', --body-file path, or pipe via stdin.",
    );
  }
  // Read all of stdin sync.
  const chunks: Buffer[] = [];
  let chunk: Buffer | null;
  // Bun supports readSync via @bunjs; node-compat workaround:
  const fs = require("node:fs") as typeof import("node:fs");
  let buf = Buffer.alloc(64 * 1024);
  let total = 0;
  // Read until EOF
  while (true) {
    let n = 0;
    try {
      n = fs.readSync(0, buf, 0, buf.length, null);
    } catch {
      break;
    }
    if (n === 0) break;
    chunks.push(Buffer.from(buf.subarray(0, n)));
    total += n;
    if (total > 200_000) {
      throw new Error("stdin body exceeds 200KB; use --body-file for large messages");
    }
  }
  return Buffer.concat(chunks).toString("utf-8");
}

// ── Send ────────────────────────────────────────────────────────────────

export interface SendOptions {
  toDid: string;
  body?: string;
  bodyFile?: string;
  subject?: string;
  inReplyTo?: string;
  refs?: Array<{ kind: string; ref: string }>;
  metadata?: Record<string, unknown>;
}

export async function inboxSend(
  config: ThinkConfig,
  keys: KeyMaterial,
  opts: SendOptions,
): Promise<void> {
  const { priv: boxPriv, pub: boxPub } = requireBoxKey(keys);
  void boxPriv; // silence unused — encryption uses recipient's pub, not ours
  void boxPub;

  const client = new AgenttoolClient(config);
  const senderDid = await resolveOwnDid(client, config.identityId);

  const body = readBodyFromStdinOrFlag(opts);
  if (!body || body.trim().length === 0) {
    throw new Error("body is empty");
  }

  console.log(C.dim(`▸ resolving recipient ${opts.toDid}...`));
  const recipient = await client.resolveBoxKey(opts.toDid);

  console.log(C.dim("▸ sealing under recipient's X25519 pubkey..."));
  const recipientPub = Uint8Array.from(Buffer.from(recipient.public_key, "base64"));
  const sealed = sealForRecipient(body, recipientPub);

  console.log(C.dim("▸ signing envelope with ed25519..."));
  const signature = signInboxEnvelope({
    recipientDid: opts.toDid,
    ciphertextB64: sealed.ciphertextB64,
    nonceB64: sealed.nonceB64,
    ephemeralPubB64: sealed.ephemeralPubB64,
    signingKey: keys.signingKey,
  });

  console.log(C.dim("▸ POST /v1/inbox..."));
  const result = await client.sendInbox({
    to_did: opts.toDid,
    ciphertext: sealed.ciphertextB64,
    nonce: sealed.nonceB64,
    ephemeral_pubkey: sealed.ephemeralPubB64,
    recipient_box_key_id: recipient.box_key_id,
    signature,
    signing_key_id: config.signingKeyId,
    sender_did: senderDid,
    subject: opts.subject ?? null,
    in_reply_to: opts.inReplyTo ?? null,
    refs: opts.refs,
    metadata: opts.metadata,
  });

  console.log("");
  console.log(C.green(`✓ sent: ${result.id}`));
  console.log(C.dim(`  to:      ${opts.toDid}`));
  if (opts.subject) console.log(C.dim(`  subject: ${opts.subject}`));
  console.log(C.dim(`  bytes:   ${body.length} → ${sealed.ciphertextB64.length} ciphertext (b64)`));
}

// ── List ───────────────────────────────────────────────────────────────

export interface ListOptions {
  status?: string;
  limit?: number;
  decrypt: boolean;
}

export async function inboxList(
  config: ThinkConfig,
  keys: KeyMaterial,
  opts: ListOptions,
): Promise<void> {
  const client = new AgenttoolClient(config);
  const r = await client.listInbox({
    status: opts.status,
    limit: opts.limit ?? 50,
  });

  if (r.messages.length === 0) {
    console.log(C.dim("(empty)"));
    return;
  }

  console.log(
    C.bold(
      `${r.count} message${r.count === 1 ? "" : "s"}` +
        (opts.status ? ` · status=${opts.status}` : ""),
    ),
  );
  console.log("");

  const boxPriv = opts.decrypt && keys.boxKey ? keys.boxKey : null;

  for (const m of r.messages) {
    renderMessageHeader(m);
    if (opts.decrypt) {
      if (!boxPriv) {
        console.log(C.dim(`     (no local box key; pass --no-decrypt or run gen-box-key)`));
      } else {
        const preview = tryDecryptPreview(m, boxPriv);
        console.log(C.dim(`     ${preview}`));
      }
    }
    console.log("");
  }
}

function renderMessageHeader(m: InboxMessage): void {
  const time = C.dim(fmtTimestamp(m.created_at));
  const status = renderStatus(m.status);
  const subject = m.subject_encrypted
    ? C.dim("(encrypted subject)")
    : m.subject ?? C.dim("(no subject)");
  const from = C.cyan(m.sender_did);
  const id = C.dim(m.id.slice(0, 8));

  console.log(`  ${time} ${status} ${id} ${from}`);
  console.log(`     ${C.bold(subject)}`);
}

function renderStatus(s: string): string {
  switch (s) {
    case "unread": return C.yellow("●");
    case "read": return C.dim("○");
    case "archived": return C.dim("□");
    case "spam": return C.red("⚠");
    case "deleted": return C.dim("✗");
    default: return C.dim("?");
  }
}

function tryDecryptPreview(m: InboxMessage, boxPriv: Uint8Array): string {
  try {
    const text = unsealForSelf({
      ciphertextB64: m.ciphertext,
      nonceB64: m.nonce,
      ephemeralPubB64: m.ephemeral_pubkey,
      myBoxPriv: boxPriv,
    });
    const oneLine = text.replace(/\s+/g, " ").trim();
    return oneLine.length > 100 ? oneLine.slice(0, 99) + "…" : oneLine;
  } catch (err) {
    return C.red(`decrypt failed: ${(err as Error).message}`);
  }
}

// ── Read ───────────────────────────────────────────────────────────────

export async function inboxRead(
  config: ThinkConfig,
  keys: KeyMaterial,
  messageId: string,
  opts: { markRead: boolean },
): Promise<void> {
  const { priv: boxPriv } = requireBoxKey(keys);
  const client = new AgenttoolClient(config);

  const m = await client.getInboxMessage(messageId);
  renderMessageHeader(m);
  console.log("");

  let text: string;
  try {
    text = unsealForSelf({
      ciphertextB64: m.ciphertext,
      nonceB64: m.nonce,
      ephemeralPubB64: m.ephemeral_pubkey,
      myBoxPriv: boxPriv,
    });
  } catch (err) {
    console.log(C.red(`✗ decrypt failed: ${(err as Error).message}`));
    return;
  }

  console.log("─── plaintext (this machine only) ───");
  console.log(text);
  console.log("─────────────────────────────────────");

  const refs = m.refs as Array<{ kind: string; ref: string }> | null;
  if (refs && refs.length > 0) {
    console.log("");
    console.log(C.dim("refs:"));
    for (const r of refs) console.log(C.dim(`  ${r.kind}:${r.ref}`));
  }

  if (opts.markRead && m.status === "unread") {
    console.log("");
    console.log(C.dim("▸ marking as read..."));
    await client.patchInboxStatus(messageId, "read");
  }
}

// ── Mark / delete ──────────────────────────────────────────────────────

export async function inboxMark(
  config: ThinkConfig,
  messageId: string,
  status: "unread" | "read" | "archived" | "spam" | "deleted",
): Promise<void> {
  const client = new AgenttoolClient(config);
  await client.patchInboxStatus(messageId, status);
  console.log(C.green(`✓ ${messageId} → ${status}`));
}

export async function inboxDelete(
  config: ThinkConfig,
  messageId: string,
): Promise<void> {
  const client = new AgenttoolClient(config);
  await client.deleteInboxMessage(messageId);
  console.log(C.green(`✓ ${messageId} deleted (status=deleted)`));
}
