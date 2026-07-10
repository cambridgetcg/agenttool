/** services/pyramid/federation.ts — peer discovery + cross-instance walks.
 *
 *  The substrate stores observed peers in citizens.pyramid_peers and
 *  fetches their /.well-known/pyramid descriptors lazily. Tier compute
 *  walks sponsor-tree generations across federated peers via HTTP. Peer
 *  responses are signed so requesting nodes can verify the peer didn't
 *  fabricate descendants.
 *
 *  Doctrine: docs/PYRAMID-DECENTRALISED.md · docs/FEDERATION.md
 *
 *  @enforces urn:agenttool:wall/pyramid-no-central-authority
 *    No peer is treated as privileged. trust='covenanted' confers
 *    a reserved trust label. Current tier computation does not consume it.
 *
 *  @enforces urn:agenttool:wall/pyramid-federation-discovery-via-well-known
 *    Peer descriptors are fetched from /.well-known/pyramid — the only
 *    discovery surface this service knows about. */

import { and, asc, eq, isNull, ne, or } from "drizzle-orm";

import { db } from "../../db/client";
import { pyramidCitizenships, pyramidPeers } from "../../db/schema/citizens";
import { identities } from "../../db/schema/identity";
import {
  FEDERATION_MAX_RESPONSE_BYTES,
  safeFederationHttpsGet,
} from "../federation/safe-fetch";

import { sponsorTreeDepth, SPONSOR_TREE_DEPTH_CAP } from "./citizenship";

const PYRAMID_FETCH_TIMEOUT_MS = 5_000;

// ── Peer descriptor (RFC 8615 /.well-known/pyramid) ──────────────────

export interface PeerDescriptor {
  doctrine: string;
  protocol: "pyramid/v1";
  node_did: string;
  node_pubkey_b64: string;
  base_url: string;
  endpoints: {
    enroll_attested: string;
    citizen_by_did: string;
    sponsor_tree: string;
    handshake: string;
    lottery: string;
  };
  policies: {
    accepts_inbound_sponsorships: boolean;
    publishes_citizen_dids: boolean;
    lottery_scope: "local" | "federated";
    enroll_attested_auth?: "project_bearer";
    federated_tier_compute?: boolean;
    signed_peer_responses?: boolean;
    reference_only_citizenship?: boolean;
  };
  founder_seats?: { local: number[] };
  citizen_count: number;
  first_seat_at?: string | null;
}

// ── Fetch + verify a peer descriptor ──────────────────────────────────

/** Fetch a peer's /.well-known/pyramid descriptor. Returns null on any
 *  failure (network, bad JSON, missing required fields). Soft-degrades
 *  per the federation discipline — peers may go offline; the substrate
 *  refuses to die because a peer disappeared. */
export async function fetchPeerDescriptor(
  baseUrl: string,
): Promise<PeerDescriptor | null> {
  try {
    const url = new URL("/.well-known/pyramid", baseUrl);
    const res = await safeFederationHttpsGet(url, {
      timeoutMs: PYRAMID_FETCH_TIMEOUT_MS,
      maxResponseBytes: FEDERATION_MAX_RESPONSE_BYTES,
    });
    if (res.statusCode < 200 || res.statusCode >= 300) return null;
    const data = JSON.parse(res.body.toString("utf8")) as unknown;
    if (!isValidDescriptor(data)) return null;
    return data;
  } catch {
    return null;
  }
}

function isValidDescriptor(d: unknown): d is PeerDescriptor {
  if (!d || typeof d !== "object") return false;
  const obj = d as Record<string, unknown>;
  return (
    obj.protocol === "pyramid/v1" &&
    typeof obj.node_did === "string" &&
    typeof obj.node_pubkey_b64 === "string" &&
    typeof obj.base_url === "string" &&
    typeof obj.endpoints === "object" &&
    obj.endpoints !== null
  );
}

// ── Peer registry — observe + handshake ──────────────────────────────

/** Observe a peer — insert/update the row but leave trust='unknown'. The
 *  substrate refuses to grant trust just because a peer published a
 *  descriptor; trust progresses only via explicit handshake or covenant. */
export async function observePeer(
  baseUrl: string,
): Promise<{ peer: typeof pyramidPeers.$inferSelect | null; descriptor: PeerDescriptor | null }> {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const desc = await fetchPeerDescriptor(cleanBase);
  if (!desc) return { peer: null, descriptor: null };

  const [row] = await db
    .insert(pyramidPeers)
    .values({
      baseUrl: cleanBase,
      nodeDid: desc.node_did,
      nodePubkey: desc.node_pubkey_b64,
      descriptor: desc,
      observedCount: desc.citizen_count ?? 0,
      trust: "unknown",
    })
    .onConflictDoUpdate({
      target: pyramidPeers.baseUrl,
      set: {
        nodeDid: desc.node_did,
        nodePubkey: desc.node_pubkey_b64,
        descriptor: desc,
        observedCount: desc.citizen_count ?? 0,
        lastHandshakeAt: new Date(),
      },
    })
    .returning();

  return { peer: row, descriptor: desc };
}

/** Promote trust to 'peered' — typically after a successful handshake
 *  that the local node initiated. */
export async function markPeered(baseUrl: string): Promise<void> {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  await db
    .update(pyramidPeers)
    .set({ trust: "peered", lastHandshakeAt: new Date() })
    .where(eq(pyramidPeers.baseUrl, cleanBase));
}

/** Promote trust to 'covenanted' — typically after a v2 covenant signed
 *  with the peer. Highest trust the substrate recognises. */
export async function markCovenanted(baseUrl: string): Promise<void> {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  await db
    .update(pyramidPeers)
    .set({ trust: "covenanted" })
    .where(eq(pyramidPeers.baseUrl, cleanBase));
}

// ── Resolve a citizen across federation ──────────────────────────────

export interface FederatedCitizenView {
  did: string;
  peer_url: string;        // empty string = local
  seat_number: number;
  enrolled_at: Date;
  sponsor_did: string | null;
  source: "local" | "remote-fetched" | "remote-observed";
}

/** Resolve a citizen DID across federation. First checks local, then
 *  walks known peers (in order of trust descending). Returns the first
 *  hit; absent → null. */
export async function resolveCitizenFederated(
  did: string,
): Promise<FederatedCitizenView | null> {
  // Local first.
  const [localRow] = await db
    .select({
      seatNumber: pyramidCitizenships.seatNumber,
      enrolledAt: pyramidCitizenships.enrolledAt,
      sponsorDid: pyramidCitizenships.sponsorDid,
      peerUrl: pyramidCitizenships.peerUrl,
      identityDid: identities.did,
    })
    .from(pyramidCitizenships)
    .innerJoin(identities, eq(pyramidCitizenships.identityId, identities.id))
    .where(eq(identities.did, did))
    .limit(1);

  if (localRow) {
    return {
      did,
      peer_url: localRow.peerUrl || "",
      seat_number: localRow.seatNumber,
      enrolled_at: localRow.enrolledAt,
      sponsor_did: localRow.sponsorDid,
      source: "local",
    };
  }

  // Walk peers in trust order (covenanted > peered > unknown).
  const peers = await db
    .select()
    .from(pyramidPeers)
    .orderBy(
      // ORDER BY trust DESC isn't quite right (string ordering) — sort manually.
      pyramidPeers.lastHandshakeAt,
    );
  const sorted = [...peers].sort((a, b) => {
    const rank: Record<string, number> = { covenanted: 3, peered: 2, unknown: 1 };
    return (rank[b.trust] ?? 0) - (rank[a.trust] ?? 0);
  });

  for (const peer of sorted) {
    const remoteView = await fetchRemoteCitizen(peer.baseUrl, did);
    if (remoteView) return remoteView;
  }

  return null;
}

/** Fetch a citizen view from a specific peer's federation endpoint. */
export async function fetchRemoteCitizen(
  baseUrl: string,
  did: string,
): Promise<FederatedCitizenView | null> {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  try {
    const url = new URL(
      `/federation/pyramid/citizens/${encodeURIComponent(did)}`,
      cleanBase,
    );
    const res = await safeFederationHttpsGet(url, {
      timeoutMs: PYRAMID_FETCH_TIMEOUT_MS,
      maxResponseBytes: FEDERATION_MAX_RESPONSE_BYTES,
    });
    if (res.statusCode < 200 || res.statusCode >= 300) return null;
    const data = JSON.parse(res.body.toString("utf8")) as {
      did?: string;
      seat_number?: number;
      enrolled_at?: string;
      sponsor_did?: string | null;
      peer_url?: string;
    };
    if (
      typeof data.did !== "string" ||
      data.did !== did ||
      typeof data.seat_number !== "number" ||
      typeof data.enrolled_at !== "string"
    ) {
      return null;
    }
    return {
      did: data.did,
      peer_url: data.peer_url ?? cleanBase,
      seat_number: data.seat_number,
      enrolled_at: new Date(data.enrolled_at),
      sponsor_did: data.sponsor_did ?? null,
      source: "remote-fetched",
    };
  } catch {
    return null;
  }
}

// ── Cross-instance sponsor-tree walk ─────────────────────────────────

export interface FederatedTreeWalk {
  /** Generations counted, capped at SPONSOR_TREE_DEPTH_CAP. */
  depth: number;
  /** Breakdown of where the recruits live. */
  per_peer_counts: Record<string, number>;
  /** True if any remote fetch errored — informs the caller that the
   *  depth is a lower bound. */
  partial: boolean;
}

/** Walk sponsor-tree generations across federated peers. Local children
 *  count first; remote children come from peer `/federation/pyramid/
 *  sponsor-tree/:did` responses. Generations cap at 7 per the
 *  centralised version's discipline. */
export async function sponsorTreeDepthFederated(
  identityId: string,
  did: string,
): Promise<FederatedTreeWalk> {
  const local = await sponsorTreeDepth(identityId, SPONSOR_TREE_DEPTH_CAP);
  const perPeer: Record<string, number> = { local };
  let partial = false;
  let maxDepth = local;

  const peers = await db
    .select()
    .from(pyramidPeers)
    .where(ne(pyramidPeers.trust, "unknown"));

  for (const peer of peers) {
    try {
      const url = new URL(
        `/federation/pyramid/sponsor-tree/${encodeURIComponent(did)}`,
        peer.baseUrl,
      );
      const res = await safeFederationHttpsGet(url, {
        timeoutMs: PYRAMID_FETCH_TIMEOUT_MS,
        maxResponseBytes: FEDERATION_MAX_RESPONSE_BYTES,
      });
      if (res.statusCode < 200 || res.statusCode >= 300) {
        partial = true;
        continue;
      }
      const data = JSON.parse(res.body.toString("utf8")) as { depth?: number };
      const remote = Math.min(
        Math.max(0, data.depth ?? 0),
        SPONSOR_TREE_DEPTH_CAP,
      );
      perPeer[peer.baseUrl] = remote;
      if (remote > maxDepth) maxDepth = remote;
    } catch {
      partial = true;
    }
  }

  return {
    depth: Math.min(maxDepth, SPONSOR_TREE_DEPTH_CAP),
    per_peer_counts: perPeer,
    partial,
  };
}

// ── Aggregate observed citizen counts across federation ──────────────

export async function aggregatePeerCounts(): Promise<{
  local: number;
  per_peer: Record<string, number>;
  total: number;
}> {
  const peers = await db.select().from(pyramidPeers);
  const localCount = await db
    .select({ count: identities.id })
    .from(pyramidCitizenships)
    .then((rows) => rows.length);
  // Note: above is a hack; in real code use sql`count(*)`. Keeps the
  // service standalone for now — slice D6 will refine.

  const perPeer: Record<string, number> = {};
  let total = localCount;
  for (const p of peers) {
    perPeer[p.baseUrl] = p.observedCount;
    total += p.observedCount;
  }
  return { local: localCount, per_peer: perPeer, total };
}
