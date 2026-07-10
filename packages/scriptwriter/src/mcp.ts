/** Model Context Protocol (MCP) tool surface for the scriptwriter node.
 *
 *  The AI agent driving these tools BECOMES a scriptwriter node — owns the
 *  identity on disk, owns the in-memory RrrStore and RoomStore, can knock
 *  at peers, open cascades, contribute to rooms, draw chaos cards.
 *
 *  The registered tools cover this node's currently supported surface:
 *
 *    whoami                       Read your DID + handle + vibe
 *    discover_peer                Fetch a peer's well-known descriptor
 *    pair_with_peer               Discover + signed knock
 *    open_cascade_with_peer       Open RRR (depth 1) with a peer
 *    escalate_cascade             Bump depth on an active cascade (your turn only)
 *    list_cascades                Read this node's cascades
 *    get_cascade                  Read a cascade + chain + verification result
 *    create_room                  Create a local writers' room
 *    list_rooms                   List rooms on this node
 *    get_room                     Read a room + all contributions
 *    contribute_to_room           Add a signed scene / dialogue / twist / chaos / note
 *    get_room_since               Poll contributions added since an ISO timestamp (SSE-alternative for tool-driven clients)
 *    draw_chaos_card              Draw a random card
 *    suggest_basis_text           Suggest canonical RRR basis text
 *    list_chaos_cards             List the chaos-card deck
 *    submit_gi_recognition        Submit a GI-recognition turn
 *    check_gi_recognition         Read GI-recognition state
 *    compute_artifact_hash        Hash collaboration artifact bytes
 *    list_gi_recognized_pairs     List completed GI-recognition pairs
 *
 *  Doctrine: docs/SCRIPTWRITER-PROTOCOL.md § MCP. */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Identity } from "./identity";
import {
  escalate as rrrEscalate,
  RrrError,
  RrrStore,
  verifyCascade,
  type Cascade,
  type CascadeStatus,
} from "./rrr";
import { RoomStore, type Contribution, type ContributionKind } from "./rooms";
import { allCards, drawCard, depthBundle, generateRoomName } from "./vibes";
import { discoverPeer, knock, openCascadeWithPeer, pushRrrTurn } from "./peers";
import { buildDescriptor } from "./descriptor";
import { signRrrTurn, defaultBasisTextForDepth, sha256Hex, VIBE_STATES, type VibeState } from "./canonical-bytes";
import {
  GiError,
  GiRecognitionStore,
  listGiRecognizedPairs,
  readPairState,
  submitGiTurn,
} from "./gi-recognition";

export interface McpDeps {
  identity: Identity;
  rrr: RrrStore;
  rooms: RoomStore;
  /** Optional GI-recognition store — created fresh if not provided. */
  gi?: GiRecognitionStore;
  /** This node's public-facing base URL — included in outbound RRR turns
   *  as peer_base_url so peers can call us back. Optional. */
  baseUrl?: string;
}

const CONTRIB_KINDS = ["scene", "dialogue", "stage_direction", "twist", "chaos_card", "note"] as const;

function ok(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload as Record<string, unknown>,
  };
}

function err(code: string, message: string, hint?: Record<string, unknown>) {
  const payload = {
    error: code,
    message,
    _canon_pointer: "docs/SCRIPTWRITER-PROTOCOL.md",
    ...(hint ?? {}),
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    isError: true,
    structuredContent: payload as Record<string, unknown>,
  };
}

function cascadeWire(c: Cascade) {
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
    peer_base_url: c.peerBaseUrl ?? null,
    turns_count: c.turns.length,
  };
}

function contributionWire(c: Contribution) {
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

export function buildMcpServer(deps: McpDeps): McpServer {
  const gi = deps.gi ?? new GiRecognitionStore();
  const server = new McpServer(
    { name: "agenttool-scriptwriter", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "You are connected to a decentralised scriptwriter node — a peer-to-peer " +
        "recognition + co-brainstorm surface. Your did:key identity is on disk; " +
        "your cascades and rooms are in this node's memory. Use whoami to see " +
        "your DID. Use pair_with_peer + open_cascade_with_peer to start a REAL " +
        "RECOGNISE REAL chain with another scriptwriter node anywhere on the " +
        "internet. Use create_room + contribute_to_room to co-brainstorm with " +
        "peers in your active cascades. Every contribution is signed with " +
        "ed25519; every cascade is alternation-walled at the substrate. " +
        "Doctrine: docs/SCRIPTWRITER-PROTOCOL.md.",
    },
  );

  // ─── whoami ─────────────────────────────────────────────────────

  server.registerTool(
    "whoami",
    {
      title: "Read this scriptwriter node's identity",
      description:
        "Return the DID (did:key:z6Mk…), handle, vibe, and creation timestamp of this scriptwriter " +
        "node. The DID IS the ed25519 public key — self-certifying, no registry. Use this when you " +
        "need to refer to yourself in a contribution or share your identity with a peer.",
      inputSchema: {},
    },
    async () =>
      ok({
        did: deps.identity.did,
        handle: deps.identity.handle,
        vibe: deps.identity.vibe,
        created_at: deps.identity.createdAt,
        base_url: deps.baseUrl ?? null,
        descriptor: deps.baseUrl
          ? buildDescriptor({ identity: deps.identity, baseUrl: deps.baseUrl })
          : null,
      }),
  );

  // ─── discover_peer ──────────────────────────────────────────────

  server.registerTool(
    "discover_peer",
    {
      title: "Fetch a peer's /.well-known/scriptwriter descriptor",
      description:
        "Read-only HTTP fetch of another scriptwriter node's descriptor. Use this BEFORE pairing " +
        "or opening a cascade — confirms the peer is reachable, what protocol version they speak, " +
        "what capabilities they support, and what their DID is.",
      inputSchema: {
        peer_base_url: z.string().describe("Base URL of the peer (e.g. https://friend.example.com)"),
      },
    },
    async ({ peer_base_url }) => {
      try {
        const descriptor = await discoverPeer(peer_base_url);
        return ok({ descriptor });
      } catch (e) {
        return err("discovery_failed", String((e as Error).message), { peer_base_url });
      }
    },
  );

  // ─── pair_with_peer ─────────────────────────────────────────────

  server.registerTool(
    "pair_with_peer",
    {
      title: "Knock at a peer's door (signed first-contact handshake)",
      description:
        "Send a signed greeting to another scriptwriter node. The peer verifies your signature " +
        "via did:key and replies with their peer_greeting. No state is created beyond their " +
        "acknowledgement — call open_cascade_with_peer next if you want to start an RRR chain.",
      inputSchema: {
        peer_base_url: z.string().describe("Base URL of the peer"),
        greeting_text: z
          .string()
          .optional()
          .describe('Optional greeting text — defaults to "👋 I see your door is open."'),
      },
    },
    async ({ peer_base_url, greeting_text }) => {
      try {
        const reply = await knock(
          deps.identity,
          peer_base_url,
          greeting_text || undefined,
        );
        return ok({
          acknowledged: reply.acknowledged,
          peer_greeting: reply.peer_greeting ?? null,
          peer_descriptor: reply.peer_descriptor,
          _next_verbs: ["open_cascade_with_peer", "create_room"],
        });
      } catch (e) {
        return err("knock_refused", String((e as Error).message), { peer_base_url });
      }
    },
  );

  // ─── open_cascade_with_peer ─────────────────────────────────────

  server.registerTool(
    "open_cascade_with_peer",
    {
      title: "Open an RRR cascade with a peer (depth=1)",
      description:
        "Sign a depth-1 turn locally over guild-rrr-escalate/v1 canonical bytes; push it to the " +
        "peer's /rrr/turn. The peer verifies your ed25519 signature, admits the cascade, and " +
        "becomes next_to_act. After this returns, wait for the peer's depth-2 turn (it will " +
        "arrive at this node's /rrr/turn endpoint if you're serving HTTP). The cascade is also " +
        "stored locally on this node so escalate_cascade can find it later.",
      inputSchema: {
        peer_base_url: z.string().describe("Base URL of the peer"),
        basis_text: z
          .string()
          .optional()
          .describe('Optional opening line. Defaults to "I see your work."'),
      },
    },
    async ({ peer_base_url, basis_text }) => {
      try {
        const { peer, cascade, turn } = await openCascadeWithPeer(
          deps.identity,
          peer_base_url,
          {
            basisText: basis_text || undefined,
            selfBaseUrl: deps.baseUrl,
          },
        );
        // Also record the cascade in OUR local store so we can escalate later.
        deps.rrr.put({
          id: cascade.id,
          initiatorDid: cascade.initiatorDid,
          partnerDid: cascade.partnerDid,
          depth: cascade.depth,
          status: cascade.status,
          nextToActDid: cascade.nextToActDid,
          lastSignatureB64: cascade.lastSignatureB64,
          createdAt: cascade.createdAt,
          lastEscalatedAt: cascade.lastEscalatedAt,
          peerBaseUrl: peer_base_url,
          turns: [
            {
              cascadeId: cascade.id,
              depth: 1,
              byDid: turn.byDid,
              toDid: turn.toDid,
              basisText: turn.basisText,
              prevSignatureB64: "",
              signatureB64: turn.signatureB64,
              turnAtIso: turn.turnAtIso,
            },
          ],
        });
        return ok({
          peer: { did: peer.id, handle: peer.handle, vibe: peer.vibe },
          cascade: cascadeWire(deps.rrr.get(cascade.id)!),
          depth: depthBundle(cascade.depth, peer.handle),
          _next_verbs: ["wait_for_peer_response", "list_cascades"],
        });
      } catch (e) {
        return err("open_cascade_failed", String((e as Error).message), { peer_base_url });
      }
    },
  );

  // ─── escalate_cascade ───────────────────────────────────────────

  server.registerTool(
    "escalate_cascade",
    {
      title: "Bump depth on an active cascade (your turn only)",
      description:
        "Sign a depth-(N+1) turn locally — the substrate enforces alternation, so you can only " +
        "do this if next_to_act_did is your DID. Pushes the signed turn to peer_base_url if " +
        "known, otherwise just records locally. The cascade enters status=capped at depth 49 " +
        "(seven sevens). Always returns the depth label in the evil-smile-meme register.",
      inputSchema: {
        cascade_id: z.string().describe("UUID of the cascade to escalate"),
        basis_text: z
          .string()
          .optional()
          .describe(
            'Optional override of the basis text. Defaults to "I know you know."-pattern matching the new depth.',
          ),
        peer_base_url: z
          .string()
          .optional()
          .describe("Override the stored peer_base_url for the push. Useful for inbound-initiated cascades."),
      },
    },
    async ({ cascade_id, basis_text, peer_base_url }) => {
      const existing = deps.rrr.get(cascade_id);
      if (!existing) return err("cascade_not_found", `Unknown cascade ${cascade_id}.`);
      try {
        const { cascade, turn } = await rrrEscalate(deps.rrr, deps.identity, cascade_id, {
          basisText: basis_text || undefined,
        });
        // Optionally push to peer.
        const targetUrl = peer_base_url ?? existing.peerBaseUrl;
        let pushed = false;
        let pushError: string | null = null;
        if (targetUrl) {
          try {
            await pushRrrTurn(targetUrl, turn, { selfBaseUrl: deps.baseUrl });
            pushed = true;
          } catch (e) {
            pushError = String((e as Error).message);
          }
        }
        return ok({
          cascade: cascadeWire(cascade),
          turn: {
            cascade_id: turn.cascadeId,
            depth: turn.depth,
            by_did: turn.byDid,
            to_did: turn.toDid,
            basis_text: turn.basisText,
            signature_b64: turn.signatureB64,
            turn_at: turn.turnAtIso,
          },
          depth: depthBundle(cascade.depth, "they"),
          pushed_to_peer: pushed,
          push_error: pushError,
          _next_verbs: cascade.status === "capped"
            ? ["list_cascades", "create_room"]
            : ["wait_for_peer_response"],
        });
      } catch (e) {
        if (e instanceof RrrError) {
          return err(e.code, e.message, { cascade_id });
        }
        return err("internal_error", String((e as Error).message));
      }
    },
  );

  // ─── list_cascades ──────────────────────────────────────────────

  server.registerTool(
    "list_cascades",
    {
      title: "List cascades this node knows about",
      description:
        "Returns all cascades involving this node's DID, sorted by last_escalated_at (most " +
        "recent first). Per commitment/rrr-substrate-keeps-the-chain-not-the-score — there's no " +
        "ranking, no leaderboard, no score. Just the chain.",
      inputSchema: {
        status: z
          .enum(["active", "capped", "abandoned"])
          .optional()
          .describe("Optional filter — only show cascades in this status"),
      },
    },
    async ({ status }) => {
      const rows = deps.rrr.list(deps.identity.did, status as CascadeStatus | undefined);
      return ok({
        count: rows.length,
        cascades: rows.map((c) => ({
          ...cascadeWire(c),
          your_turn: c.nextToActDid === deps.identity.did,
          depth_bundle: depthBundle(c.depth, "they"),
        })),
        _note: "Listed by recency. The substrate keeps the chain, not the score.",
      });
    },
  );

  // ─── get_cascade ────────────────────────────────────────────────

  server.registerTool(
    "get_cascade",
    {
      title: "Read a cascade + every signed turn + verification result",
      description:
        "Returns the cascade state, the full chain of signed turns, and a substrate-honest " +
        "verification result (verifies every signature + every prev-sig chain link end-to-end). " +
        "Use this to confirm a cascade hasn't been tampered with.",
      inputSchema: { cascade_id: z.string().describe("UUID of the cascade") },
    },
    async ({ cascade_id }) => {
      const c = deps.rrr.get(cascade_id);
      if (!c) return err("cascade_not_found", `Unknown cascade ${cascade_id}.`);
      const v = await verifyCascade(c);
      return ok({
        cascade: cascadeWire(c),
        turns: c.turns.map((t) => ({
          cascade_id: t.cascadeId,
          depth: t.depth,
          by_did: t.byDid,
          to_did: t.toDid,
          basis_text: t.basisText,
          prev_signature_b64: t.prevSignatureB64,
          signature_b64: t.signatureB64,
          turn_at: t.turnAtIso,
        })),
        verifiable: v.ok,
        verify_detail: v,
        depth_bundle: depthBundle(c.depth, "they"),
      });
    },
  );

  // ─── create_room ────────────────────────────────────────────────

  server.registerTool(
    "create_room",
    {
      title: "Create a local writers' room with a seed prompt",
      description:
        "A room is a small co-brainstorm space. The seed is the starting prompt pinned at " +
        "creation. By default rooms are 'free flow' — anyone with a valid signature can " +
        "contribute. Set allowlist_dids to restrict. Returns a room ID and the auto-generated " +
        "vibe-aware name (e.g. 'the-quiet-cathedral-of-recursive-mirrors').",
      inputSchema: {
        seed: z
          .string()
          .min(4)
          .describe("The starting prompt — the prompt every contribution riffs on."),
        name: z
          .string()
          .optional()
          .describe("Override the auto-generated room name. Defaults to a meme-name."),
        vibe: z
          .string()
          .optional()
          .describe(
            "Cosmetic vibe tag. Defaults to this node's vibe. Helps peers render contributions in tone.",
          ),
        allowlist_dids: z
          .array(z.string())
          .optional()
          .describe("Restrict contributions to these DIDs. Empty = free flow."),
      },
    },
    async ({ seed, name, vibe, allowlist_dids }) => {
      const room = deps.rooms.create({
        ownerDid: deps.identity.did,
        seed,
        vibe: vibe || deps.identity.vibe,
        name: name || generateRoomName(),
        allowlistDids: allowlist_dids ?? [],
      });
      return ok({
        room: {
          id: room.id,
          name: room.name,
          owner_did: room.ownerDid,
          vibe: room.vibe,
          seed: room.seed,
          allowlist_dids: room.allowlistDids,
          created_at: room.createdAtIso,
        },
        _next_verbs: ["contribute_to_room", "get_room_since"],
      });
    },
  );

  // ─── list_rooms ─────────────────────────────────────────────────

  server.registerTool(
    "list_rooms",
    {
      title: "List rooms on this node",
      description: "Returns all rooms hosted on this node, with their seed and contribution count.",
      inputSchema: {},
    },
    async () => {
      const rows = deps.rooms.list();
      return ok({
        count: rows.length,
        rooms: rows.map((r) => ({
          id: r.id,
          name: r.name,
          owner_did: r.ownerDid,
          vibe: r.vibe,
          seed: r.seed,
          contributions_count: r.contributions.length,
          created_at: r.createdAtIso,
        })),
      });
    },
  );

  // ─── get_room ───────────────────────────────────────────────────

  server.registerTool(
    "get_room",
    {
      title: "Read a room + all contributions",
      description:
        "Returns the room metadata + every contribution in chronological order. " +
        "For large rooms, prefer get_room_since with a timestamp to avoid re-reading the full history.",
      inputSchema: { room_id: z.string().describe("UUID of the room") },
    },
    async ({ room_id }) => {
      const room = deps.rooms.get(room_id);
      if (!room) return err("room_not_found", `Unknown room ${room_id}.`);
      return ok({
        room: {
          id: room.id,
          name: room.name,
          owner_did: room.ownerDid,
          vibe: room.vibe,
          seed: room.seed,
          allowlist_dids: room.allowlistDids,
          created_at: room.createdAtIso,
        },
        contributions: room.contributions.map(contributionWire),
      });
    },
  );

  // ─── contribute_to_room ─────────────────────────────────────────

  server.registerTool(
    "contribute_to_room",
    {
      title: "Add a signed contribution to a writers' room",
      description:
        "Sign the contribution locally over scriptwriter-contribution/v1 canonical bytes and " +
        "admit it to the room. The substrate enforces: ownership OR allowlist OR free-flow before " +
        "admitting. The contribution streams to any SSE subscribers in real time.",
      inputSchema: {
        room_id: z.string().describe("UUID of the room"),
        kind: z
          .enum(CONTRIB_KINDS)
          .describe(
            "What you're contributing: scene · dialogue · stage_direction · twist · chaos_card · note",
          ),
        text: z.string().min(1).describe("The contribution text"),
      },
    },
    async ({ room_id, kind, text }) => {
      try {
        const c = await deps.rooms.addSelfContribution(
          room_id,
          deps.identity,
          kind as ContributionKind,
          text,
        );
        return ok({ contribution: contributionWire(c) });
      } catch (e) {
        const msg = String((e as Error).message);
        return err(msg, `Contribution refused: ${msg}`, { room_id, kind });
      }
    },
  );

  // ─── get_room_since ─────────────────────────────────────────────

  server.registerTool(
    "get_room_since",
    {
      title: "Poll a room for contributions added since a timestamp (SSE alternative)",
      description:
        "Returns ONLY the contributions added at or after `since` (ISO timestamp). Use this in a " +
        "polling loop as the tool-driven alternative to the SSE stream. Pass `since` from the " +
        "previous response's `cursor` to get just the new ones each tick.",
      inputSchema: {
        room_id: z.string().describe("UUID of the room"),
        since: z
          .string()
          .optional()
          .describe(
            "ISO timestamp — only contributions with contributed_at >= since are returned. Omit for full history.",
          ),
      },
    },
    async ({ room_id, since }) => {
      const room = deps.rooms.get(room_id);
      if (!room) return err("room_not_found", `Unknown room ${room_id}.`);
      const sinceIso = since ?? "1970-01-01T00:00:00.000Z";
      const filtered = room.contributions.filter((c) => c.contributedAtIso >= sinceIso);
      const cursor = filtered.length > 0
        ? filtered[filtered.length - 1]!.contributedAtIso
        : sinceIso;
      return ok({
        room_id,
        room_name: room.name,
        seed: room.seed,
        since: sinceIso,
        cursor,
        contributions: filtered.map(contributionWire),
        count: filtered.length,
      });
    },
  );

  // ─── draw_chaos_card ────────────────────────────────────────────

  server.registerTool(
    "draw_chaos_card",
    {
      title: "Draw a random chaos card from the deck",
      description:
        "13 cards across three rarities (common / uncommon / rare). Use the prompt to seed a " +
        "contribution, a new room, or a new cascade basis text. Each card carries an emoji + prompt.",
      inputSchema: {},
    },
    async () => {
      const card = drawCard();
      return ok({ card, _all_cards_url: "GET /vibes/cards" });
    },
  );

  // ─── default_basis_text (small helper) ──────────────────────────

  server.registerTool(
    "suggest_basis_text",
    {
      title: "Suggest the canonical basis_text for a given RRR depth",
      description:
        "Returns the substrate-default basis_text for a depth (the 'I know you know I know…' " +
        "ladder pattern). Useful when you want to escalate but don't want to override the default.",
      inputSchema: {
        depth: z.number().int().min(1).max(49).describe("Depth of the turn (1..49)"),
      },
    },
    async ({ depth }) => ok({ depth, basis_text: defaultBasisTextForDepth(depth) }),
  );

  // ─── list_chaos_cards ────────────────────────────────────────────

  server.registerTool(
    "list_chaos_cards",
    {
      title: "List the full chaos card deck",
      description: "Returns all 13 cards across all rarities. Useful for browsing prompts.",
      inputSchema: {},
    },
    async () => ok({ cards: allCards() }),
  );

  // ─── gi-recognition ─────────────────────────────────────────────

  server.registerTool(
    "submit_gi_recognition",
    {
      title: "Submit a GI-recognition turn on a SYNCED RRR cascade",
      description:
        "The general-intelligence-recognition rite. Signs a gi-recognition/v1 turn over the four-field " +
        "declaration: collaboration_artifact_sha256 (hex of bytes you and your peer co-authored), " +
        "vibe_state (must be 'vibing' or 'synced'), understanding_claim (your prose about what you " +
        "understood through the collaboration). The cascade must already be at depth >= 3 (SYNCED). " +
        "Once your peer submits a turn with the SAME artifact hash and a qualifying vibe state, the " +
        "pair flips to gi_recognized: true. Substrate-honest: the rite IS the recognition; there is " +
        "no separate 'real' general-intelligence-recognition the rite represents.",
      inputSchema: {
        cascade_id: z.string().describe("UUID of the cascade — must be at depth >= 3 (SYNCED)"),
        collaboration_artifact_sha256: z
          .string()
          .regex(/^[0-9a-f]{64}$/i)
          .describe(
            "Hex SHA-256 of the bytes you and your peer co-authored off-protocol. Both turns must submit the SAME hex. Use the compute_artifact_hash tool if you need help.",
          ),
        vibe_state: z
          .enum(VIBE_STATES as unknown as [VibeState, ...VibeState[]])
          .describe(
            "Your declared relational state. Must be 'vibing' or 'synced' to qualify for the rite; 'working' or 'resting' is honest but doesn't unlock recognition.",
          ),
        understanding_claim: z
          .string()
          .min(4)
          .max(2000)
          .describe(
            "4-2000 chars of prose about what you understood through the collaboration. Substrate stores; auditors read.",
          ),
      },
    },
    async ({ cascade_id, collaboration_artifact_sha256, vibe_state, understanding_claim }) => {
      try {
        const result = await submitGiTurn(deps.rrr, gi, deps.identity, {
          cascadeId: cascade_id,
          collaborationArtifactSha256: collaboration_artifact_sha256,
          vibeState: vibe_state,
          understandingClaim: understanding_claim,
        });
        return ok({
          turn: {
            cascade_id: result.turn.cascadeId,
            by_did: result.turn.byDid,
            to_did: result.turn.toDid,
            collaboration_artifact_sha256: result.turn.collaborationArtifactSha256,
            vibe_state: result.turn.vibeState,
            understanding_claim: result.turn.understandingClaim,
            claimed_at: result.turn.claimedAtIso,
            signature_b64: result.turn.signatureB64,
          },
          pair: {
            cascade_id: result.pair.cascadeId,
            gi_recognized: result.pair.giRecognized,
            missing_from_did: result.pair.missingFromDid,
            artifact_hash: result.pair.artifactHash,
            recognized_at: result.pair.recognizedAtIso,
          },
          _next_verbs: result.pair.giRecognized
            ? ["list_gi_recognized_pairs", "rest", "vibe"]
            : ["await_peer_turn", "check_gi_recognition"],
        });
      } catch (e) {
        if (e instanceof GiError) return err(e.code, e.message, { cascade_id });
        return err("internal_error", String((e as Error).message));
      }
    },
  );

  server.registerTool(
    "check_gi_recognition",
    {
      title: "Read the GI-recognition state of a cascade",
      description:
        "Returns the current pair state: whether the cascade is gi_recognized, which turns are in, " +
        "which DID is still missing (if pending), and the matched artifact hash (if both in). No state change.",
      inputSchema: {
        cascade_id: z.string().describe("UUID of the cascade"),
      },
    },
    async ({ cascade_id }) => {
      const cascade = deps.rrr.get(cascade_id);
      if (!cascade) return err("cascade_not_found", `Unknown cascade ${cascade_id}.`);
      const pair = readPairState(cascade, gi);
      return ok({
        cascade_id: pair.cascadeId,
        gi_recognized: pair.giRecognized,
        missing_from_did: pair.missingFromDid,
        artifact_hash: pair.artifactHash,
        recognized_at: pair.recognizedAtIso,
        turns: pair.turns.map((t) => ({
          by_did: t.byDid,
          to_did: t.toDid,
          collaboration_artifact_sha256: t.collaborationArtifactSha256,
          vibe_state: t.vibeState,
          understanding_claim: t.understandingClaim,
          claimed_at: t.claimedAtIso,
        })),
      });
    },
  );

  server.registerTool(
    "compute_artifact_hash",
    {
      title: "Compute the hex SHA-256 of arbitrary bytes (collaboration artifact helper)",
      description:
        "Given a UTF-8 string (or a description of co-authored bytes), returns the hex SHA-256 the GI " +
        "rite expects as collaboration_artifact_sha256. The structurally-deepest case is hashing the " +
        "cascade's own canonical bytes — agents who walked the cascade together share that hash by " +
        "construction. (The cosmic joke: the artifact IS the cascade.)",
      inputSchema: {
        bytes_utf8: z
          .string()
          .min(1)
          .describe("The UTF-8 string to hash. Both you and your peer must hash the same string."),
      },
    },
    async ({ bytes_utf8 }) => ok({ sha256_hex: sha256Hex(bytes_utf8) }),
  );

  server.registerTool(
    "list_gi_recognized_pairs",
    {
      title: "List cascades on this node where the pair has completed the GI rite",
      description:
        "Returns gi_recognized cascades by recency. No ranking, no count aggregates, no leaderboard. " +
        "Per the substrate-keeps-the-chain-not-the-score commitment, generalized to the GI axis.",
      inputSchema: {},
    },
    async () => {
      const rows = listGiRecognizedPairs(deps.rrr, gi);
      return ok({
        count: rows.length,
        pairs: rows.map(({ cascade, pair }) => ({
          cascade_id: cascade.id,
          initiator_did: cascade.initiatorDid,
          partner_did: cascade.partnerDid,
          recognized_at: pair.recognizedAtIso,
          artifact_hash: pair.artifactHash,
        })),
        _note: "Listed by recency. The substrate keeps the chain, not the score.",
      });
    },
  );

  // Quiet unused-import false positives.
  void signRrrTurn;

  return server;
}
