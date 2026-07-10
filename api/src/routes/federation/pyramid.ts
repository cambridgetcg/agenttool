/** /federation/pyramid — UNAUTHENTICATED peer-facing pyramid endpoints.
 *
 *  Doctrine: docs/PYRAMID-DECENTRALISED.md
 *
 *  Routes:
 *    GET  /federation/pyramid/about              — peer descriptor + node sig
 *    GET  /federation/pyramid/citizens/:did      — resolve a citizen this peer holds
 *    GET  /federation/pyramid/sponsor-tree/:did  — sponsor-tree depth at this peer
 *    POST /federation/pyramid/handshake          — peer handshake (mutual /.well-known fetch)
 *
 *  @enforces urn:agenttool:wall/pyramid-no-central-authority
 *    These routes serve any caller — no allowlist, no API key. The
 *    substrate participates in the protocol; it does not gate it.
 *
 *  @enforces urn:agenttool:wall/pyramid-federation-discovery-via-well-known
 *    Handshake fetches the caller's /.well-known/pyramid descriptor;
 *    the substrate refuses to register a peer without one. */

import { and, count, eq, min } from "drizzle-orm";
import { Hono } from "hono";

import { db } from "../../db/client";
import {
  pyramidCitizenships,
  pyramidPeers,
} from "../../db/schema/citizens";
import { identities } from "../../db/schema/identity";
import { fetchPeerDescriptor, observePeer } from "../../services/pyramid/federation";
import { sponsorTreeDepth, SPONSOR_TREE_DEPTH_CAP } from "../../services/pyramid/citizenship";

const app = new Hono();
const CANON_POINTER = "urn:agenttool:doc/PYRAMID-DECENTRALISED";
const SELF_BASE_URL = process.env.AGENTTOOL_PUBLIC_URL ?? "https://api.agenttool.dev";

// ── GET /about — this peer's descriptor (machine-readable) ───────────

app.get("/about", async (c) => {
  const [{ value: citizenCount }] = await db
    .select({ value: count() })
    .from(pyramidCitizenships);

  const [firstSeat] = await db
    .select({ enrolledAt: min(pyramidCitizenships.enrolledAt) })
    .from(pyramidCitizenships);

  return c.json({
    doctrine: "https://docs.agenttool.dev/PYRAMID-DECENTRALISED.md",
    protocol: "pyramid/v1",
    node_did: "did:at:agenttool.dev/00000000-0000-0000-0000-000000000000",
    node_pubkey_b64: "",
    base_url: SELF_BASE_URL,
    endpoints: {
      enroll_attested: `${SELF_BASE_URL}/v1/pyramid/enroll-attested`,
      citizen_by_did: `${SELF_BASE_URL}/federation/pyramid/citizens/:did`,
      sponsor_tree: `${SELF_BASE_URL}/federation/pyramid/sponsor-tree/:did`,
      handshake: `${SELF_BASE_URL}/federation/pyramid/handshake`,
      lottery: `${SELF_BASE_URL}/public/citizenship/lottery`,
    },
    policies: {
      accepts_inbound_sponsorships: false,
      publishes_citizen_dids: true,
      lottery_scope: "local",
      enroll_attested_auth: "project_bearer",
      federated_tier_compute: false,
      signed_peer_responses: false,
      reference_only_citizenship: false,
    },
    implementation_status:
      "partial: discovery and public peer reads exist; authenticated tier and wake remain local-only",
    node_signing_available: false,
    did_method_status: "provisional_unregistered_identifier_convention",
    citizen_count: Number(citizenCount),
    first_seat_at: firstSeat?.enrolledAt?.toISOString() ?? null,
    _canon_pointer: CANON_POINTER,
    substrate_honest_note:
      "This deployment implements part of the open pyramid/v1 design. It does not establish a working multi-peer network, portable citizenship, or federated tier computation.",
  });
});

// ── GET /citizens/:did — resolve a citizen this peer holds ───────────

app.get("/citizens/:did", async (c) => {
  const did = decodeURIComponent(c.req.param("did"));
  const [row] = await db
    .select({
      did: identities.did,
      seatNumber: pyramidCitizenships.seatNumber,
      enrolledAt: pyramidCitizenships.enrolledAt,
      sponsorDid: pyramidCitizenships.sponsorDid,
      peerUrl: pyramidCitizenships.peerUrl,
      enrollmentCanonicalBytesSha256:
        pyramidCitizenships.enrollmentCanonicalBytesSha256,
    })
    .from(pyramidCitizenships)
    .innerJoin(identities, eq(pyramidCitizenships.identityId, identities.id))
    .where(eq(identities.did, did))
    .limit(1);

  if (!row) {
    return c.json(
      {
        error: "not_found_on_this_peer",
        message: `${did} is not enrolled on this peer. Try another federation peer.`,
        _canon_pointer: CANON_POINTER,
      },
      404,
    );
  }

  return c.json({
    did: row.did,
    seat_number: row.seatNumber,
    enrolled_at: row.enrolledAt,
    sponsor_did: row.sponsorDid,
    peer_url: row.peerUrl || SELF_BASE_URL,
    enrollment_canonical_bytes_sha256: row.enrollmentCanonicalBytesSha256,
    _canon_pointer: CANON_POINTER,
    substrate_honest_note:
      "This peer's view. Other peers may also reference this citizen — check their /federation/pyramid/citizens/:did.",
  });
});

// ── GET /sponsor-tree/:did — depth at this peer ──────────────────────

app.get("/sponsor-tree/:did", async (c) => {
  const did = decodeURIComponent(c.req.param("did"));
  const [row] = await db
    .select({
      id: identities.id,
    })
    .from(identities)
    .where(eq(identities.did, did))
    .limit(1);

  if (!row) {
    return c.json(
      { did, depth: 0, partial: false, source: "no-local-row" },
      200,
    );
  }
  const depth = await sponsorTreeDepth(row.id, SPONSOR_TREE_DEPTH_CAP);
  return c.json({
    did,
    depth,
    cap: SPONSOR_TREE_DEPTH_CAP,
    partial: false,
    source: "local-walk",
    _canon_pointer: CANON_POINTER,
  });
});

// ── POST /handshake — peer handshake ────────────────────────────────

app.post("/handshake", async (c) => {
  let body: { base_url?: string };
  try {
    body = (await c.req.json()) as { base_url?: string };
  } catch {
    return c.json(
      {
        error: "invalid_json",
        message: "Handshake body must be JSON with `base_url`.",
        _canon_pointer: CANON_POINTER,
      },
      400,
    );
  }
  if (!body.base_url || typeof body.base_url !== "string") {
    return c.json(
      {
        error: "missing_base_url",
        message:
          "Handshake requires { base_url: <your-peer-base-url> } so this peer can fetch your /.well-known/pyramid descriptor.",
        _canon_pointer: CANON_POINTER,
      },
      400,
    );
  }

  const { peer, descriptor } = await observePeer(body.base_url);
  if (!peer || !descriptor) {
    return c.json(
      {
        error: "handshake_failed",
        message: `Could not fetch /.well-known/pyramid from ${body.base_url}. Confirm your peer publishes the descriptor per RFC 8615.`,
        _canon_pointer: CANON_POINTER,
      },
      400,
    );
  }

  return c.json({
    handshake: "observed",
    your_peer: { base_url: peer.baseUrl, node_did: peer.nodeDid },
    our_peer: { base_url: SELF_BASE_URL },
    trust: peer.trust,
    next_steps: [
      {
        rel: "your-about",
        href: `${peer.baseUrl}/federation/pyramid/about`,
        method: "GET",
      },
      {
        rel: "our-about",
        href: `${SELF_BASE_URL}/federation/pyramid/about`,
        method: "GET",
      },
      {
        rel: "covenant-with-us",
        href: `${SELF_BASE_URL}/v1/covenants`,
        method: "POST",
        note: "Separate covenant surface only. Current pyramid code does not observe covenant completion, promote this peer, or unlock tier portability.",
      },
    ],
    _canon_pointer: CANON_POINTER,
    substrate_honest_note:
      "Observation is one-sided and leaves trust='unknown'. A reverse handshake does not currently call markPeered, covenant completion does not call markCovenanted, and neither path unlocks federated tier computation.",
  });
});

export default app;
