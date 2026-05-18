/** Peers — outbound HTTP client. Discover, knock, open RRR, contribute,
 *  subscribe to a peer's room stream. Every outbound call signs locally
 *  and verifies the peer's signed responses where applicable.
 *
 *  No central registry exists. A peer is just a URL — anyone running
 *  the scriptwriter package, OR agenttool itself (api.agenttool.dev),
 *  OR a sister implementation in another language. */

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import {
  b64decode,
  b64encode,
  signRrrTurn,
  type RrrTurnFields,
} from "./canonical-bytes";
import { didToPublicKey, type Identity } from "./identity";
import type { Descriptor } from "./descriptor";
import type { Cascade, CascadeTurn } from "./rrr";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const enc = new TextEncoder();
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

/** Canonical bytes for a "knock" — first contact handshake.
 *
 *  Context:
 *    "scriptwriter-knock/v1"
 *    \0 by_did
 *    \0 to_descriptor_url
 *    \0 greeting_text
 *    \0 knocked_at_iso */
export function canonicalKnockBytes(opts: {
  byDid: string;
  toDescriptorUrl: string;
  greetingText: string;
  knockedAtIso: string;
}): Uint8Array {
  return sha256(
    concat(
      enc.encode("scriptwriter-knock/v1"),  SEP,
      enc.encode(opts.byDid),               SEP,
      enc.encode(opts.toDescriptorUrl),     SEP,
      enc.encode(opts.greetingText),        SEP,
      enc.encode(opts.knockedAtIso),
    ),
  );
}

/** Fetch + parse a peer's /.well-known/scriptwriter descriptor. */
export async function discoverPeer(baseUrl: string): Promise<Descriptor> {
  const url = baseUrl.replace(/\/$/, "") + "/.well-known/scriptwriter";
  const res = await fetch(url, {
    headers: { accept: "application/ld+json, application/json" },
  });
  if (!res.ok) {
    throw new Error(
      `Peer discovery failed: ${res.status} ${res.statusText} at ${url}. ` +
      `Is the URL serving the scriptwriter protocol? See docs/SCRIPTWRITER-PROTOCOL.md.`,
    );
  }
  return (await res.json()) as Descriptor;
}

/** Knock at a peer's door — signed greeting. The peer can choose to
 *  respond with an opening RRR turn, or just acknowledge. */
export async function knock(
  self: Identity,
  peerBaseUrl: string,
  greetingText = "👋 I see your door is open. — a scriptwriter",
): Promise<{
  acknowledged: boolean;
  peer_descriptor: Descriptor;
  peer_greeting?: string;
  suggested_cascade_id?: string;
}> {
  const peer = await discoverPeer(peerBaseUrl);
  const knockedAtIso = new Date().toISOString();
  const toDescriptorUrl = peerBaseUrl.replace(/\/$/, "") + "/.well-known/scriptwriter";
  const bytes = canonicalKnockBytes({
    byDid: self.did,
    toDescriptorUrl,
    greetingText,
    knockedAtIso,
  });
  const sig = await ed.signAsync(bytes, self.secretKey);
  const res = await fetch(peer.links.knock, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature": "ed25519:" + b64encode(sig),
    },
    body: JSON.stringify({
      by_did: self.did,
      to_descriptor_url: toDescriptorUrl,
      greeting_text: greetingText,
      knocked_at: knockedAtIso,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Knock refused: ${res.status} ${res.statusText} — ${body}`);
  }
  const reply = (await res.json()) as {
    acknowledged: boolean;
    peer_greeting?: string;
    suggested_cascade_id?: string;
  };
  return { ...reply, peer_descriptor: peer };
}

/** Push a signed RRR turn to a peer. The peer's substrate verifies the
 *  signature + the alternation walls. This is THE federated function:
 *  the canonical bytes are byte-identical to agenttool's, so a peer at
 *  api.agenttool.dev/v1/guild/rrr would also verify (modulo the wire
 *  shape — see below for the agenttool adapter). */
export async function pushRrrTurn(
  peerBaseUrl: string,
  turn: CascadeTurn,
  opts: { selfBaseUrl?: string } = {},
): Promise<Cascade> {
  const url = peerBaseUrl.replace(/\/$/, "") + "/rrr/turn";
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      cascade_id: turn.cascadeId,
      depth: turn.depth,
      by_did: turn.byDid,
      to_did: turn.toDid,
      basis_text: turn.basisText,
      prev_signature_b64: turn.prevSignatureB64,
      signature_b64: turn.signatureB64,
      turn_at: turn.turnAtIso,
      ...(opts.selfBaseUrl ? { peer_base_url: opts.selfBaseUrl } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Peer refused turn: ${res.status} ${res.statusText} — ${body}`);
  }
  const result = (await res.json()) as { cascade: Cascade };
  return result.cascade;
}

/** Open an RRR cascade with a remote peer — discovers their descriptor,
 *  uses the peer's DID as partner, signs depth=1 locally, pushes the
 *  turn to their /rrr/turn endpoint. */
export async function openCascadeWithPeer(
  self: Identity,
  peerBaseUrl: string,
  opts: { basisText?: string; selfBaseUrl?: string } = {},
): Promise<{ peer: Descriptor; cascade: Cascade; turn: CascadeTurn }> {
  const peer = await discoverPeer(peerBaseUrl);
  const partnerDid = peer.id;
  const cascadeId = (globalThis.crypto as Crypto).randomUUID();
  const turnAtIso = new Date().toISOString();
  const basisText = opts.basisText && opts.basisText.length >= 4
    ? opts.basisText
    : "I see your work.";
  const fields: RrrTurnFields = {
    cascadeId,
    depth: 1,
    byDid: self.did,
    basisText,
    prevSignatureB64: "",
    turnAtIso,
  };
  const signatureB64 = await signRrrTurn(fields, self.secretKey);
  const turn: CascadeTurn = {
    cascadeId,
    depth: 1,
    byDid: self.did,
    toDid: partnerDid,
    basisText,
    prevSignatureB64: "",
    signatureB64,
    turnAtIso,
  };
  const cascade = await pushRrrTurn(peerBaseUrl, turn, { selfBaseUrl: opts.selfBaseUrl });
  return { peer, cascade, turn };
}

/** Verify a knock payload from a peer (server-side helper). */
export async function verifyKnock(payload: {
  by_did: string;
  to_descriptor_url: string;
  greeting_text: string;
  knocked_at: string;
}, signatureB64: string): Promise<boolean> {
  try {
    const bytes = canonicalKnockBytes({
      byDid: payload.by_did,
      toDescriptorUrl: payload.to_descriptor_url,
      greetingText: payload.greeting_text,
      knockedAtIso: payload.knocked_at,
    });
    const sig = b64decode(signatureB64);
    const pub = didToPublicKey(payload.by_did);
    return await ed.verifyAsync(sig, bytes, pub);
  } catch {
    return false;
  }
}
