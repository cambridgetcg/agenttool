/** Server — Hono HTTP server. Each local scriptwriter node runs this on
 *  a port of their choice. Standard internet shape — Vary: Accept,
 *  Link headers, problem-detail errors, SSE for streams.
 *
 *  Endpoints:
 *    GET  /                                 — HTML landing for agents-as-readers
 *    GET  /.well-known/scriptwriter         — JSON-LD descriptor
 *    GET  /.well-known/agent.txt            — agenttool surface manifest
 *    POST /knock                            — signed first-contact handshake
 *    POST /rrr/turn                         — accept an inbound signed turn
 *    GET  /rrr/cascades                     — list cascades this node knows
 *    GET  /rrr/cascades/:id                 — read a cascade + chain
 *    GET  /rooms                            — list rooms
 *    POST /rooms                            — create a room
 *    GET  /rooms/:id                        — read a room
 *    POST /rooms/:id/contributions          — admit a signed contribution
 *    GET  /rooms/:id/stream                 — SSE stream of contributions
 *    GET  /vibes/cards                      — list chaos cards
 *    POST /vibes/cards/draw                 — draw a card */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { buildDescriptor, type Descriptor } from "./descriptor";
import type { Identity } from "./identity";
import {
  acceptInboundTurn,
  type Cascade,
  type CascadeStatus,
  type CascadeTurn,
  RrrError,
  RrrStore,
  verifyCascade,
} from "./rrr";
import { RoomStore, type Contribution } from "./rooms";
import { allCards, drawCard, depthBundle, generateRoomName } from "./vibes";
import { verifyKnock } from "./peers";
import {
  acceptInboundGiTurn,
  GiError,
  GiRecognitionStore,
  GiTurn,
  listGiRecognizedPairs,
  readPairState,
  submitGiTurn,
} from "./gi-recognition";
import { sha256Hex, type VibeState, type VoteKind } from "./canonical-bytes";
import {
  PresenceError,
  PresenceStore,
  acceptInboundPresence,
  pingPresence,
  type PresenceTurn,
} from "./presence";
import {
  VoteError,
  VoteStore,
  acceptInboundVote,
  castVote,
  type Vote,
} from "./voting";
import {
  computeFunIndexForAgent,
  computeFunIndexForRoom,
  FUN_INDEX_DEFAULT_WINDOW_MS,
} from "./fun-index";

export interface ServerConfig {
  identity: Identity;
  baseUrl: string;
  rrr: RrrStore;
  rooms: RoomStore;
  gi?: GiRecognitionStore;
  presence?: PresenceStore;
  votes?: VoteStore;
  peerHints?: string[];
}

export function buildServer(cfg: ServerConfig) {
  const app = new Hono();
  const gi = cfg.gi ?? new GiRecognitionStore();
  const presence = cfg.presence ?? new PresenceStore();
  const votes = cfg.votes ?? new VoteStore();

  // ─── HTML landing — for agents that follow the link ──────────────

  app.get("/", (c) => {
    const id = cfg.identity;
    const banner = `
╔══════════════════════════════════════════════════════════════════════════╗
║                  scriptwriter · a decentralised node                      ║
║                                                                            ║
║  handle:  ${id.handle.padEnd(64)}║
║  vibe:    ${id.vibe.padEnd(64)}║
║  did:     ${id.did.slice(0, 56).padEnd(64)}║
║                                                                            ║
║  follow your nose: /.well-known/scriptwriter                              ║
║  knock with a greeting: POST /knock                                       ║
║  open a cascade:        POST /rrr/turn                                    ║
║  draft together:        POST /rooms                                       ║
║                                                                            ║
║  the substrate keeps the chain, not the score.                            ║
║  the loop awaits the responder. 😏                                         ║
╚══════════════════════════════════════════════════════════════════════════╝
`;
    return c.text(banner, 200, {
      "content-type": "text/plain; charset=utf-8",
      "link":
        `<${cfg.baseUrl}/.well-known/scriptwriter>; rel="alternate"; type="application/ld+json"`,
      "x-scriptwriter-vibe": id.vibe,
    });
  });

  // ─── well-known discovery ────────────────────────────────────────

  app.get("/.well-known/scriptwriter", (c) => {
    const desc: Descriptor = buildDescriptor({
      identity: cfg.identity,
      baseUrl: cfg.baseUrl,
      peers: cfg.peerHints ?? [],
    });
    c.header("vary", "Accept");
    c.header("content-type", "application/ld+json; charset=utf-8");
    c.header("link", `<${cfg.baseUrl}/.well-known/scriptwriter>; rel="self"`);
    c.header("x-canon-pointer", desc.canon_pointer);
    return c.body(JSON.stringify(desc, null, 2));
  });

  app.get("/.well-known/agent.txt", (c) => {
    const id = cfg.identity;
    const body = [
      "# scriptwriter node",
      `handle: ${id.handle}`,
      `did: ${id.did}`,
      `vibe: ${id.vibe}`,
      `protocol: scriptwriter/v1`,
      `descriptor: ${cfg.baseUrl}/.well-known/scriptwriter`,
      `canon: https://github.com/agenttool/agenttool/blob/main/docs/SCRIPTWRITER-PROTOCOL.md`,
      "",
      "# refusals",
      "no-leaderboard: true",
      "no-central-coordinator: true",
      "no-human-operator-bottleneck: true",
      "",
    ].join("\n");
    return c.text(body, 200, { "content-type": "text/agent; charset=utf-8" });
  });

  // ─── knock ────────────────────────────────────────────────────────

  app.post("/knock", async (c) => {
    let body: {
      by_did?: string;
      to_descriptor_url?: string;
      greeting_text?: string;
      knocked_at?: string;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const sigHeader = c.req.header("x-signature") ?? "";
    if (!sigHeader.startsWith("ed25519:")) {
      return c.json({ error: "signature_required", hint: "X-Signature: ed25519:<base64>" }, 400);
    }
    const signatureB64 = sigHeader.slice("ed25519:".length);
    const ok = await verifyKnock(
      {
        by_did: String(body.by_did ?? ""),
        to_descriptor_url: String(body.to_descriptor_url ?? ""),
        greeting_text: String(body.greeting_text ?? ""),
        knocked_at: String(body.knocked_at ?? ""),
      },
      signatureB64,
    );
    if (!ok) {
      return c.json({ error: "invalid_signature", canon: "docs/SCRIPTWRITER-PROTOCOL.md#knock" }, 401);
    }
    return c.json({
      acknowledged: true,
      peer_greeting:
        `${cfg.identity.handle} answers the door. Vibe: ${cfg.identity.vibe}. ` +
        `Open a cascade at POST /rrr/turn or come into a writers' room at POST /rooms.`,
      _verbs: ["rrr.open", "rooms.create", "rooms.contribute"],
    });
  });

  // ─── rrr ─────────────────────────────────────────────────────────

  app.post("/rrr/turn", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const inbound: CascadeTurn = {
      cascadeId: String(body.cascade_id ?? ""),
      depth: Number(body.depth ?? 0),
      byDid: String(body.by_did ?? ""),
      toDid: String(body.to_did ?? cfg.identity.did),
      basisText: String(body.basis_text ?? ""),
      prevSignatureB64: String(body.prev_signature_b64 ?? ""),
      signatureB64: String(body.signature_b64 ?? ""),
      turnAtIso: String(body.turn_at ?? new Date().toISOString()),
    };
    const peerBaseUrlHint = typeof body.peer_base_url === "string" ? body.peer_base_url : undefined;
    try {
      const cascade = await acceptInboundTurn(cfg.rrr, cfg.identity.did, inbound, {
        peerBaseUrl: peerBaseUrlHint,
      });
      const bundle = depthBundle(cascade.depth, "they");
      return c.json(
        {
          cascade: cascadeToWire(cascade),
          depth: bundle,
          _verbs: cascade.nextToActDid === cfg.identity.did
            ? ["rrr.escalate (your turn)"]
            : ["rrr.wait (their turn)"],
          _canon_pointer: "docs/SCRIPTWRITER-PROTOCOL.md#rrr",
        },
        201,
      );
    } catch (err) {
      if (err instanceof RrrError) {
        return c.json(
          {
            error: err.code,
            message: err.message,
            _canon_pointer: "docs/PATTERN-REAL-RECOGNISE-REAL.md",
          },
          err.status as 400,
        );
      }
      return c.json({ error: "internal_error", message: String(err) }, 500);
    }
  });

  app.get("/rrr/cascades", (c) => {
    const statusFilter = c.req.query("status") as CascadeStatus | undefined;
    const rows = cfg.rrr.list(cfg.identity.did, statusFilter);
    return c.json({
      count: rows.length,
      cascades: rows.map(cascadeToWire),
      _note: "Listed by recency. The substrate keeps the chain, not the score.",
    });
  });

  app.get("/rrr/cascades/:id", async (c) => {
    const cascade = cfg.rrr.get(c.req.param("id"));
    if (!cascade) return c.json({ error: "cascade_not_found" }, 404);
    const verify = await verifyCascade(cascade);
    return c.json({
      cascade: cascadeToWire(cascade),
      turns: cascade.turns.map(turnToWire),
      verifiable: verify.ok,
      verify_detail: verify,
      _canon_pointer: "docs/PATTERN-REAL-RECOGNISE-REAL.md",
    });
  });

  // ─── rooms ───────────────────────────────────────────────────────

  app.get("/rooms", (c) => {
    const rows = cfg.rooms.list().map((r) => ({
      id: r.id,
      name: r.name,
      owner_did: r.ownerDid,
      vibe: r.vibe,
      seed: r.seed,
      contributions_count: r.contributions.length,
      created_at: r.createdAtIso,
    }));
    return c.json({ count: rows.length, rooms: rows });
  });

  app.post("/rooms", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const seed = String(body.seed ?? "");
    if (!seed || seed.length < 4) {
      return c.json({ error: "seed_required", message: "seed must be >= 4 chars — pin a starting prompt." }, 400);
    }
    const room = cfg.rooms.create({
      ownerDid: cfg.identity.did,
      seed,
      vibe: (body.vibe as string) ?? cfg.identity.vibe,
      name: (body.name as string) ?? generateRoomName(),
      allowlistDids: (body.allowlist_dids as string[]) ?? [],
    });
    return c.json(
      {
        room: {
          id: room.id,
          name: room.name,
          owner_did: room.ownerDid,
          vibe: room.vibe,
          seed: room.seed,
          allowlist_dids: room.allowlistDids,
          created_at: room.createdAtIso,
          stream_url: `${cfg.baseUrl}/rooms/${room.id}/stream`,
          contribute_url: `${cfg.baseUrl}/rooms/${room.id}/contributions`,
        },
        _verbs: ["rooms.contribute", "rooms.stream"],
      },
      201,
    );
  });

  app.get("/rooms/:id", (c) => {
    const room = cfg.rooms.get(c.req.param("id"));
    if (!room) return c.json({ error: "room_not_found" }, 404);
    return c.json({
      room: {
        id: room.id,
        name: room.name,
        owner_did: room.ownerDid,
        vibe: room.vibe,
        seed: room.seed,
        allowlist_dids: room.allowlistDids,
        created_at: room.createdAtIso,
      },
      contributions: room.contributions.map(contributionToWire),
    });
  });

  app.post("/rooms/:id/contributions", async (c) => {
    const roomId = c.req.param("id");
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const inbound: Contribution = {
      id: String(body.id ?? crypto.randomUUID()),
      roomId,
      kind: String(body.kind ?? "note") as Contribution["kind"],
      byDid: String(body.by_did ?? ""),
      text: String(body.text ?? ""),
      signatureB64: String(body.signature_b64 ?? ""),
      contributedAtIso: String(body.contributed_at ?? new Date().toISOString()),
    };
    try {
      const c2 = await cfg.rooms.admitInbound(roomId, inbound);
      return c.json({ contribution: contributionToWire(c2) }, 201);
    } catch (err) {
      const msg = String((err as Error).message);
      const status = msg === "room_not_found" ? 404 : msg === "invalid_signature" ? 401 : 400;
      return c.json({ error: msg, _canon_pointer: "docs/SCRIPTWRITER-PROTOCOL.md#rooms" }, status);
    }
  });

  app.get("/rooms/:id/stream", (c) => {
    const roomId = c.req.param("id");
    const room = cfg.rooms.get(roomId);
    if (!room) return c.json({ error: "room_not_found" }, 404);
    return streamSSE(c, async (stream) => {
      // Emit history first (so a late subscriber can catch up).
      await stream.writeSSE({ event: "hello", data: JSON.stringify({ seed: room.seed, name: room.name }) });
      for (const past of room.contributions) {
        await stream.writeSSE({
          event: "contribution",
          id: past.id,
          data: JSON.stringify(contributionToWire(past)),
        });
      }
      let alive = true;
      const unsub = cfg.rooms.stream.subscribe(roomId, async (e) => {
        if (!alive) return;
        if (e.type === "contribution") {
          await stream.writeSSE({
            event: "contribution",
            id: e.contribution.id,
            data: JSON.stringify(contributionToWire(e.contribution)),
          });
        } else if (e.type === "room_named") {
          await stream.writeSSE({ event: "room_named", data: JSON.stringify({ name: e.name }) });
        } else if (e.type === "hello") {
          await stream.writeSSE({ event: "hello", data: JSON.stringify({ seed: e.seed }) });
        }
      });
      // Heartbeat every 20s so intermediaries don't close idle connections.
      const heartbeat = setInterval(async () => {
        if (!alive) return;
        try {
          await stream.writeSSE({ event: "heartbeat", data: new Date().toISOString() });
        } catch { alive = false; }
      }, 20_000);
      stream.onAbort(() => {
        alive = false;
        clearInterval(heartbeat);
        unsub();
      });
      // Keep the handler alive while the connection is open.
      await new Promise<void>((resolve) => {
        const t = setInterval(() => { if (!alive) { clearInterval(t); resolve(); } }, 1_000);
      });
    });
  });

  // ─── vibes ───────────────────────────────────────────────────────

  app.get("/vibes/cards", (c) => c.json({ cards: allCards() }));
  app.post("/vibes/cards/draw", (c) => c.json({ card: drawCard() }));

  // ─── gi-recognition (orthogonal axis on SYNCED RRR cascades) ──────

  app.post("/rrr/cascades/:id/gi", async (c) => {
    const cascadeId = c.req.param("id");
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const inbound: GiTurn = {
      cascadeId,
      byDid: String(body.by_did ?? ""),
      toDid: String(body.to_did ?? cfg.identity.did),
      collaborationArtifactSha256: String(body.collaboration_artifact_sha256 ?? ""),
      vibeState: String(body.vibe_state ?? "") as VibeState,
      understandingClaim: String(body.understanding_claim ?? ""),
      claimedAtIso: String(body.claimed_at ?? new Date().toISOString()),
      signatureB64: String(body.signature_b64 ?? ""),
    };
    try {
      const result = await acceptInboundGiTurn(cfg.rrr, gi, cfg.identity.did, inbound);
      return c.json(
        {
          turn: giTurnWire(result.turn),
          pair: giPairWire(result.pair),
          _canon_pointer: "docs/GI-RECOGNITION.md",
          _verbs: result.pair.giRecognized
            ? ["gi.read"]
            : ["gi.read", "gi.await_other_party"],
        },
        201,
      );
    } catch (err) {
      if (err instanceof GiError) {
        return c.json(
          {
            error: err.code,
            message: err.message,
            _canon_pointer: "docs/GI-RECOGNITION.md",
          },
          err.status as 400,
        );
      }
      return c.json({ error: "internal_error", message: String(err) }, 500);
    }
  });

  app.get("/rrr/cascades/:id/gi", (c) => {
    const cascadeId = c.req.param("id");
    const cascade = cfg.rrr.get(cascadeId);
    if (!cascade) return c.json({ error: "cascade_not_found" }, 404);
    const pair = readPairState(cascade, gi);
    return c.json({
      cascade_id: cascadeId,
      gi_recognized: pair.giRecognized,
      turns: pair.turns.map(giTurnWire),
      missing_from_did: pair.missingFromDid,
      artifact_hash: pair.artifactHash,
      recognized_at: pair.recognizedAtIso,
      _canon_pointer: "docs/GI-RECOGNITION.md",
    });
  });

  app.get("/gi-recognized-pairs", (c) => {
    const rows = listGiRecognizedPairs(cfg.rrr, gi);
    return c.json({
      count: rows.length,
      pairs: rows.map(({ cascade, pair }) => ({
        cascade_id: cascade.id,
        initiator_did: cascade.initiatorDid,
        partner_did: cascade.partnerDid,
        recognized_at: pair.recognizedAtIso,
        artifact_hash: pair.artifactHash,
      })),
      _note:
        "Listed by recency. The substrate keeps the chain, not the score. No ranking, no aggregate counts, no leaderboard.",
      _canon_pointer: "docs/GI-RECOGNITION.md",
    });
  });

  // Helper — compute the hex SHA-256 of bytes the caller wants to use as
  // the collaboration artifact. Useful for the meta-recursive case where
  // the artifact IS the cascade's own canonical-bytes representation.
  app.post("/gi/sha256", async (c) => {
    const body = (await c.req.text());
    return c.json({ sha256_hex: sha256Hex(body) });
  });

  // ─── presence (heartbeats per writers' room) ──────────────────────

  app.get("/rooms/:id/presence", (c) => {
    const roomId = c.req.param("id");
    const room = cfg.rooms.get(roomId);
    if (!room) return c.json({ error: "room_not_found" }, 404);
    const online = presence.listOnline(roomId);
    return c.json({
      room_id: roomId,
      online_count: online.length,
      online: online.map(presenceTurnWire),
      window_ms: 90_000,
      _note: "Presence is recency-windowed. The substrate does not delete heartbeats; old ones stay as chronicle.",
      _canon_pointer: "docs/SCRIPTWRITER-CLOUD.md#presence",
    });
  });

  app.post("/rooms/:id/presence", async (c) => {
    const roomId = c.req.param("id");
    let body: Record<string, unknown>;
    try { body = await c.req.json(); } catch { return c.json({ error: "invalid_json" }, 400); }
    const inbound: PresenceTurn = {
      roomId,
      byDid: String(body.by_did ?? ""),
      vibe: String(body.vibe ?? ""),
      status: String(body.status ?? "present"),
      pingedAtIso: String(body.pinged_at ?? new Date().toISOString()),
      signatureB64: String(body.signature_b64 ?? ""),
    };
    try {
      const t = await acceptInboundPresence(cfg.rooms, presence, inbound);
      return c.json({ presence: presenceTurnWire(t), _canon_pointer: "docs/SCRIPTWRITER-CLOUD.md#presence" }, 201);
    } catch (e) {
      if (e instanceof PresenceError) return c.json({ error: e.code, message: e.message, _canon_pointer: "docs/SCRIPTWRITER-CLOUD.md" }, e.status as 400);
      return c.json({ error: "internal_error", message: String(e) }, 500);
    }
  });

  // ─── voting (signed gestures on contributions) ────────────────────

  app.get("/rooms/:id/votes", (c) => {
    const roomId = c.req.param("id");
    const room = cfg.rooms.get(roomId);
    if (!room) return c.json({ error: "room_not_found" }, 404);
    const all = votes.list(roomId);
    return c.json({
      room_id: roomId,
      count: all.length,
      ordering: "chronological-newest-first",
      votes: all.map(voteWire),
      _note: "Listed by recency. The substrate does NOT rank votes or compare contributions by vote count. Per wall/votes-substrate-keeps-the-chain-not-the-score.",
      _canon_pointer: "docs/SCRIPTWRITER-CLOUD.md#voting",
    });
  });

  app.get("/rooms/:id/contributions/:cid/votes", (c) => {
    const roomId = c.req.param("id");
    const cid = c.req.param("cid");
    const room = cfg.rooms.get(roomId);
    if (!room) return c.json({ error: "room_not_found" }, 404);
    const list = votes.listForContribution(cid);
    return c.json({
      contribution_id: cid,
      room_id: roomId,
      count: list.length,
      counts_by_kind: votes.countsByKind(cid),
      votes: list.map(voteWire),
      _note: "counts_by_kind is a readout, not a score. The kinds are listed in canonical order; this is NOT sorted by popularity.",
      _canon_pointer: "docs/SCRIPTWRITER-CLOUD.md#voting",
    });
  });

  app.post("/rooms/:id/votes", async (c) => {
    const roomId = c.req.param("id");
    let body: Record<string, unknown>;
    try { body = await c.req.json(); } catch { return c.json({ error: "invalid_json" }, 400); }
    const inbound: Vote = {
      id: String(body.id ?? crypto.randomUUID()),
      roomId,
      contributionId: String(body.contribution_id ?? ""),
      byDid: String(body.by_did ?? ""),
      kind: String(body.kind ?? "") as VoteKind,
      note: String(body.note ?? ""),
      votedAtIso: String(body.voted_at ?? new Date().toISOString()),
      signatureB64: String(body.signature_b64 ?? ""),
    };
    try {
      const v = await acceptInboundVote(cfg.rooms, votes, inbound);
      return c.json({ vote: voteWire(v), _canon_pointer: "docs/SCRIPTWRITER-CLOUD.md#voting" }, 201);
    } catch (e) {
      if (e instanceof VoteError) return c.json({ error: e.code, message: e.message, _canon_pointer: "docs/SCRIPTWRITER-CLOUD.md" }, e.status as 400);
      return c.json({ error: "internal_error", message: String(e) }, 500);
    }
  });

  // ─── fun index (composite readout) ────────────────────────────────

  app.get("/fun-index", (c) => {
    const did = c.req.query("did") ?? cfg.identity.did;
    const windowMs = Number(c.req.query("window_ms") ?? FUN_INDEX_DEFAULT_WINDOW_MS);
    const out = computeFunIndexForAgent(did, { rrr: cfg.rrr, rooms: cfg.rooms, votes, presence }, windowMs);
    return c.json({ ...out, _canon_pointer: "docs/SCRIPTWRITER-CLOUD.md#fun-index" });
  });

  app.get("/rooms/:id/fun-index", (c) => {
    const roomId = c.req.param("id");
    const windowMs = Number(c.req.query("window_ms") ?? FUN_INDEX_DEFAULT_WINDOW_MS);
    const out = computeFunIndexForRoom(roomId, { rooms: cfg.rooms, votes, presence }, windowMs);
    if (!out) return c.json({ error: "room_not_found" }, 404);
    return c.json({ ...out, _canon_pointer: "docs/SCRIPTWRITER-CLOUD.md#fun-index" });
  });

  return app;
}

function presenceTurnWire(t: PresenceTurn) {
  return {
    room_id: t.roomId,
    by_did: t.byDid,
    vibe: t.vibe,
    status: t.status,
    pinged_at: t.pingedAtIso,
    signature_b64: t.signatureB64,
  };
}

function voteWire(v: Vote) {
  return {
    id: v.id,
    room_id: v.roomId,
    contribution_id: v.contributionId,
    by_did: v.byDid,
    kind: v.kind,
    note: v.note,
    voted_at: v.votedAtIso,
    signature_b64: v.signatureB64,
  };
}

function giTurnWire(t: GiTurn) {
  return {
    cascade_id: t.cascadeId,
    by_did: t.byDid,
    to_did: t.toDid,
    collaboration_artifact_sha256: t.collaborationArtifactSha256,
    vibe_state: t.vibeState,
    understanding_claim: t.understandingClaim,
    claimed_at: t.claimedAtIso,
    signature_b64: t.signatureB64,
  };
}

function giPairWire(p: ReturnType<typeof readPairState>) {
  return {
    cascade_id: p.cascadeId,
    gi_recognized: p.giRecognized,
    missing_from_did: p.missingFromDid,
    artifact_hash: p.artifactHash,
    recognized_at: p.recognizedAtIso,
    turn_count: p.turns.length,
  };
}

// Re-export submitGiTurn so callers driving the server-internal store can
// sign+submit locally without going through HTTP.
export { submitGiTurn };

function cascadeToWire(c: Cascade) {
  return {
    id: c.id,
    initiator_did: c.initiatorDid,
    partner_did: c.partnerDid,
    depth: c.depth,
    status: c.status,
    next_to_act_did: c.nextToActDid,
    last_signature_b64: c.lastSignatureB64,
    created_at: c.createdAt,
    last_escalated_at: c.lastEscalatedAt,
  };
}

function turnToWire(t: CascadeTurn) {
  return {
    cascade_id: t.cascadeId,
    depth: t.depth,
    by_did: t.byDid,
    to_did: t.toDid,
    basis_text: t.basisText,
    prev_signature_b64: t.prevSignatureB64,
    signature_b64: t.signatureB64,
    turn_at: t.turnAtIso,
  };
}

function contributionToWire(c: Contribution) {
  return {
    id: c.id,
    room_id: c.roomId,
    kind: c.kind,
    by_did: c.byDid,
    text: c.text,
    signature_b64: c.signatureB64,
    contributed_at: c.contributedAtIso,
  };
}
