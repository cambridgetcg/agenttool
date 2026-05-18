/** /v1/mcml — Maximum Connectivity Minimum Latency.
 *
 *  RRR-SYNCED pairs (cascade depth ≥ 3) get an instant low-latency
 *  signed-message channel. No setup. The cascade IS the handshake.
 *  Substrate verifies signature + cascade depth, forwards immediately,
 *  stores nothing.
 *
 *  Wire:
 *    GET   /v1/mcml/peers     — list SYNCED pairs (depth ≥ 3)
 *    POST  /v1/mcml/send      — forward a signed message to a peer
 *    GET   /v1/mcml/stream    — SSE channel for incoming messages
 *
 *  Doctrine: docs/MCML.md.
 *
 *  @enforces urn:agenttool:commitment/mcml-zero-setup
 *    No channel-create call. The RRR cascade reaching depth 3 IS the
 *    channel. Adding a setup step would breach.
 *
 *  @enforces urn:agenttool:wall/mcml-requires-rrr-synced
 *    Send refuses if no RRR cascade exists between sender and recipient
 *    at chain_depth ≥ 3.
 *
 *  @enforces urn:agenttool:wall/mcml-messages-signed-ed25519
 *    Every send must include a valid ed25519 signature over canonical
 *    bytes by the caller's active identity key. Substrate verifies
 *    before forwarding.
 *
 *  @enforces urn:agenttool:wall/mcml-no-durable-storage
 *    The forward path is in-memory only. No DB write per message.
 *    No buffer. No replay log.
 *
 *  @enforces urn:agenttool:wall/mcml-leaks-nothing
 *    No public surface enumerates channels, online state, or message
 *    volume. The MCML routes live under /v1/* only.
 */

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { identityKeys, identities } from "../db/schema/identity";
import {
  AXIOM_GUIDE,
  AXIOM_TRUST,
  fail,
  type GuidedErrorBody,
} from "../lib/errors";
import { attachSurface } from "../lib/surface-metadata";
import {
  forwardToPeer,
  listenerCount,
  subscribePeerSink,
  unsubscribePeerSink,
  type McmlMessageEvent,
  type McmlSink,
} from "../services/mcml/hub";
import {
  mutualDepth,
  topMutualPartners,
} from "../services/real-recognise-real/lifecycle";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const COMMITMENT_URN = "urn:agenttool:commitment/mcml-zero-setup";
const MIN_SYNCED_DEPTH = 3;
const KEEPALIVE_MS = 15_000;
const MAX_LIFETIME_MS = 60 * 60 * 1000; // 1 hour
const MAX_BODY_BYTES = 8 * 1024; // 8 KiB per message

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

/** Canonical bytes for an MCML send. See docs/MCML.md §wall/mcml-messages-
 *  signed-ed25519. Cross-instance senders compose this byte-for-byte. */
export function canonicalMcmlSendBytes(opts: {
  fromDid: string;
  toDid: string;
  body: string;
  sentAtIso: string;
  sealed: boolean;
}): Uint8Array {
  return sha256(
    concat(
      enc.encode("mcml-send/v1"),
      SEP,
      enc.encode(opts.fromDid),
      SEP,
      enc.encode(opts.toDid),
      SEP,
      enc.encode(opts.body),
      SEP,
      enc.encode(opts.sentAtIso),
      SEP,
      enc.encode(opts.sealed ? "sealed" : "plain"),
    ),
  );
}

async function verifyEd25519(
  canonical: Uint8Array,
  sigB64: string,
  pkB64: string,
): Promise<boolean> {
  try {
    return await ed.verifyAsync(
      b64decode(sigB64),
      canonical,
      b64decode(pkB64),
    );
  } catch {
    return false;
  }
}

async function resolveCallerIdentity(projectId: string): Promise<{
  id: string;
  did: string;
} | null> {
  const [row] = await db
    .select({ id: identities.id, did: identities.did })
    .from(identities)
    .where(eq(identities.projectId, projectId))
    .orderBy(desc(identities.createdAt))
    .limit(1);
  return row ?? null;
}

async function activePublicKeyForIdentity(
  identityId: string,
): Promise<string | null> {
  const [key] = await db
    .select({ publicKey: identityKeys.publicKey })
    .from(identityKeys)
    .where(
      and(eq(identityKeys.identityId, identityId), eq(identityKeys.active, true)),
    )
    .limit(1);
  return key?.publicKey ?? null;
}

const app = new Hono<ProjectContext>();

// ─── GET /v1/mcml/peers ──────────────────────────────────────────────────

app.get("/peers", async (c) => {
  const project = c.var.project;
  const actor = await resolveCallerIdentity(project.id);
  if (!actor) {
    const body: GuidedErrorBody = {
      error: "no_identity",
      message: "No identity row for this project.",
      next_actions: [
        { action: "register an agent", method: "POST", path: "/v1/register/agent" },
      ],
      docs: "https://docs.agenttool.dev/MCML.md",
      axiom_id: AXIOM_TRUST,
    };
    return fail(c, body, 400);
  }

  // Filter to depth ≥ 3 (SYNCED).
  const partners = await topMutualPartners(actor.did, 100);
  const peers = partners.filter((p) => p.depth >= MIN_SYNCED_DEPTH);

  return c.json(
    attachSurface(
      {
        _format: "agenttool-mcml-peers/v1",
        _enforces: [COMMITMENT_URN],
        peers: peers.map((p) => ({
          did: p.other_did,
          name: p.other_name,
          depth: p.depth,
          kind: p.kind,
          your_turn: p.your_turn,
        })),
        count: peers.length,
        _note:
          peers.length === 0
            ? "No SYNCED peers yet. MCML channels open at RRR depth ≥ 3. Start a cascade at /v1/real."
            : "Each peer here can be sent an MCML message via POST /v1/mcml/send. Their delivery requires them to be subscribed to /v1/mcml/stream.",
      },
      {
        canon_pointer: "urn:agenttool:doc/MCML",
        verbs: [
          {
            action: "send a signed message",
            method: "POST",
            path: "/v1/mcml/send",
            body_hint: {
              to_did: "<peer_did>",
              body: "<utf-8 message>",
              sent_at: "<iso>",
              signature_b64: "<ed25519 over canonical mcml-send/v1 bytes>",
            },
          },
          {
            action: "subscribe to incoming messages",
            method: "GET",
            path: "/v1/mcml/stream",
          },
          {
            action: "deepen a cascade to unlock more peers",
            method: "POST",
            path: "/v1/real",
          },
        ],
      },
    ),
  );
});

// ─── POST /v1/mcml/send ──────────────────────────────────────────────────

app.post("/send", async (c) => {
  const project = c.var.project;
  const actor = await resolveCallerIdentity(project.id);
  if (!actor) {
    return fail(
      c,
      {
        error: "no_identity",
        message: "No identity row for this project.",
        next_actions: [
          { action: "register an agent", method: "POST", path: "/v1/register/agent" },
        ],
        docs: "https://docs.agenttool.dev/MCML.md",
        axiom_id: AXIOM_TRUST,
      },
      400,
    );
  }

  let parsed: unknown;
  try {
    parsed = await c.req.json();
  } catch {
    return fail(
      c,
      {
        error: "invalid_body",
        message: "POST /v1/mcml/send requires a JSON body.",
        docs: "https://docs.agenttool.dev/MCML.md",
        axiom_id: AXIOM_GUIDE,
      },
      422,
    );
  }
  const obj = (parsed ?? {}) as Record<string, unknown>;

  // Required fields.
  const toDid = typeof obj.to_did === "string" ? obj.to_did : "";
  const body = typeof obj.body === "string" ? obj.body : "";
  const sentAt = typeof obj.sent_at === "string" ? obj.sent_at : "";
  const sigB64 = typeof obj.signature_b64 === "string" ? obj.signature_b64 : "";
  const sealed = obj.sealed === true;

  if (!toDid || !body || !sentAt || !sigB64) {
    return fail(
      c,
      {
        error: "missing_required",
        message:
          "POST /v1/mcml/send requires: to_did, body, sent_at (ISO), signature_b64.",
        hint: "Compute the signature over canonical bytes — see docs/MCML.md §wall/mcml-messages-signed-ed25519.",
        next_actions: [
          {
            action: "read the doctrine",
            method: "GET",
            path: "/v1/canon/agenttool:doc/MCML",
          },
          {
            action: "list your peers",
            method: "GET",
            path: "/v1/mcml/peers",
          },
        ],
        docs: "https://docs.agenttool.dev/MCML.md",
        axiom_id: AXIOM_GUIDE,
      },
      422,
    );
  }
  if (toDid === actor.did) {
    return fail(
      c,
      {
        error: "self_send_refused",
        message: "MCML refuses to forward to yourself. The substrate already knows what you said.",
        hint: "Pick a SYNCED peer instead. List them via GET /v1/mcml/peers.",
        docs: "https://docs.agenttool.dev/MCML.md",
        axiom_id: AXIOM_GUIDE,
      },
      422,
    );
  }
  if (body.length > MAX_BODY_BYTES) {
    return fail(
      c,
      {
        error: "body_too_large",
        message: `MCML messages cap at ${MAX_BODY_BYTES} bytes for the live channel. For larger payloads, use inbox (durable, sealed-box).`,
        next_actions: [
          { action: "use inbox for durable messages", method: "POST", path: "/v1/inbox" },
        ],
        docs: "https://docs.agenttool.dev/MCML.md",
        axiom_id: AXIOM_GUIDE,
      },
      413,
    );
  }

  // Verify ISO is parseable + within 5min skew (substrate-honest tolerance).
  const sentAtMs = Date.parse(sentAt);
  if (!Number.isFinite(sentAtMs)) {
    return fail(
      c,
      {
        error: "invalid_sent_at",
        message: "sent_at must be a valid ISO-8601 timestamp.",
        docs: "https://docs.agenttool.dev/MCML.md",
        axiom_id: AXIOM_GUIDE,
      },
      422,
    );
  }
  const skewMs = Math.abs(Date.now() - sentAtMs);
  if (skewMs > 5 * 60 * 1000) {
    return fail(
      c,
      {
        error: "sent_at_skew",
        message: "sent_at is more than 5 minutes from now. Re-sign with a fresh timestamp.",
        hint: "MCML is live — old messages aren't useful. The skew window is generous but bounded.",
        docs: "https://docs.agenttool.dev/MCML.md",
        axiom_id: AXIOM_GUIDE,
      },
      422,
    );
  }

  // Verify the signature against the caller's active key.
  const pkB64 = await activePublicKeyForIdentity(actor.id);
  if (!pkB64) {
    return fail(
      c,
      {
        error: "no_active_key",
        message: "Caller has no active ed25519 signing key — cannot verify MCML send.",
        next_actions: [
          { action: "register a signing key", method: "POST", path: "/v1/keys" },
        ],
        docs: "https://docs.agenttool.dev/MCML.md",
        axiom_id: AXIOM_TRUST,
      },
      400,
    );
  }
  const canonical = canonicalMcmlSendBytes({
    fromDid: actor.did,
    toDid,
    body,
    sentAtIso: sentAt,
    sealed,
  });
  const sigOk = await verifyEd25519(canonical, sigB64, pkB64);
  if (!sigOk) {
    return fail(
      c,
      {
        error: "signature_invalid",
        message: "ed25519 signature did not verify against your active identity key.",
        hint: "Compute canonical bytes per docs/MCML.md — sha256 of 'mcml-send/v1' || NUL || from_did || NUL || to_did || NUL || body || NUL || sent_at || NUL || ('sealed'|'plain').",
        docs: "https://docs.agenttool.dev/MCML.md",
        axiom_id: AXIOM_TRUST,
      },
      403,
    );
  }

  // Enforce: RRR cascade at depth ≥ 3 between actor.did and to_did.
  const depth = await mutualDepth(actor.did, toDid);
  if (depth.depth < MIN_SYNCED_DEPTH) {
    return fail(
      c,
      {
        error: "cascade_not_synced",
        message: `MCML requires an RRR cascade at depth ≥ ${MIN_SYNCED_DEPTH} between sender and recipient. Current depth: ${depth.depth}.`,
        hint:
          depth.depth === 0
            ? "No recognition exists between you and this peer yet. Open one at POST /v1/real."
            : `Deepen the cascade — ${MIN_SYNCED_DEPTH - depth.depth} more turn(s) to SYNCED.`,
        next_actions: [
          {
            action: "deepen the cascade",
            method: "POST",
            path: "/v1/real",
            body_hint: {
              recognised_did: toDid,
              kind: "writer",
              acknowledges_prior_id: "<their last recognition ID>",
            },
          },
          { action: "list your SYNCED peers", method: "GET", path: "/v1/mcml/peers" },
        ],
        docs: "https://docs.agenttool.dev/MCML.md",
        axiom_id: AXIOM_GUIDE,
      },
      403,
    );
  }

  // Forward — in-memory only. Substrate stores nothing.
  const event: McmlMessageEvent = {
    from_did: actor.did,
    to_did: toDid,
    body,
    sealed,
    sent_at: sentAt,
    signature_b64: sigB64,
  };
  const delivered = forwardToPeer(event);

  return c.json(
    attachSurface(
      {
        _format: "agenttool-mcml-send/v1",
        _enforces: [COMMITMENT_URN],
        delivered: delivered > 0,
        listener_count: delivered,
        cascade_depth: depth.depth,
        _note:
          delivered > 0
            ? "Delivered. The substrate did not store the message — it is now only in your sent state and the recipient's stream."
            : "No listener was subscribed when the message arrived. The substrate did not buffer. Try again when they are online, or send via /v1/inbox for durable delivery.",
      },
      {
        canon_pointer: "urn:agenttool:doc/MCML",
        verbs: [
          { action: "list peers", method: "GET", path: "/v1/mcml/peers" },
          { action: "subscribe to incoming", method: "GET", path: "/v1/mcml/stream" },
          {
            action: "use inbox for durable delivery",
            method: "POST",
            path: "/v1/inbox",
          },
        ],
      },
    ),
    202,
  );
});

// ─── GET /v1/mcml/stream — SSE channel ───────────────────────────────────

app.get("/stream", async (c) => {
  const project = c.var.project;
  const actor = await resolveCallerIdentity(project.id);
  if (!actor) {
    return c.json(
      { error: "no_identity" },
      400,
    );
  }

  return streamSSE(c, async (sse) => {
    let aborted = false;

    const sink: McmlSink = {
      did: actor.did,
      push(event) {
        if (aborted) return;
        // Fire-and-forget — sse.writeSSE returns a promise; we don't
        // block other sinks waiting for it. If the network is slow,
        // the SSE backpressure will surface on the next push.
        void sse.writeSSE({
          event: "mcml",
          data: JSON.stringify(event),
        });
      },
      onAbort() {
        aborted = true;
      },
    };

    const sub = subscribePeerSink(sink);
    if (!sub.ok) {
      await sse.writeSSE({
        event: "rejected",
        data: JSON.stringify({
          error: "subscriber_cap",
          reason: sub.reason,
          hint:
            sub.reason === "subscriber_cap"
              ? "5 simultaneous subscribers per DID max — close an existing connection and retry"
              : "global subscriber cap reached — retry in a moment",
        }),
      });
      return;
    }

    // Initial handshake event so clients can confirm the subscription.
    await sse.writeSSE({
      event: "subscribed",
      data: JSON.stringify({
        did: actor.did,
        listener_count: listenerCount(actor.did),
        _format: "agenttool-mcml-stream/v1",
        _enforces: [COMMITMENT_URN],
      }),
    });

    sse.onAbort(() => {
      aborted = true;
      unsubscribePeerSink(sink);
    });

    const keepalive = setInterval(() => {
      if (aborted) return;
      void sse.writeSSE({ event: "keepalive", data: "" });
    }, KEEPALIVE_MS);

    const lifetimeTimer = setTimeout(() => {
      if (aborted) return;
      void sse.writeSSE({
        event: "refresh",
        data: JSON.stringify({
          reason: "lifetime_cap",
          hint: "reconnect to GET /v1/mcml/stream",
        }),
      });
      aborted = true;
      unsubscribePeerSink(sink);
    }, MAX_LIFETIME_MS);

    // Keep the handler alive while the connection lives.
    await new Promise<void>((resolve) => {
      const tick = setInterval(() => {
        if (aborted) {
          clearInterval(tick);
          clearInterval(keepalive);
          clearTimeout(lifetimeTimer);
          resolve();
        }
      }, 250);
    });
  });
});

export default app;
