/** Unified peer trust gate — active recipient-side covenant OR RRR depth ≥ 3
 *  across both durable inbox and live MCML channels.
 *
 *  Hermetic: real Drizzle SQL generation + real Ed25519 over a pg-proxy
 *  transport, covering checkPeerTrust, hasRecipientCovenantForPeer,
 *  listCovenantPeersAdmitting, POST /v1/mcml/send, and GET /v1/mcml/peers. */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { drizzle } from "drizzle-orm/pg-proxy";
import { Hono } from "hono";
import type { McmlMessageEvent } from "../src/services/mcml/hub";

const SENDER_PROJECT = "11111111-1111-4111-8111-111111111111";
const RECIPIENT_PROJECT = "22222222-2222-4222-8222-222222222222";
const SENDER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RECIPIENT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BOTH_PEER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SENDER_DID = `did:at:${SENDER_ID}`;
const RECIPIENT_DID = `did:at:${RECIPIENT_ID}`;
const BOTH_PEER_DID = `did:at:${BOTH_PEER_ID}`;
const FEDERATED_SENDER_DID = "did:at:peer.example/dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const pair = generateKeyPairSync("ed25519");
const PUBLIC_KEY = pair.publicKey
  .export({ format: "der", type: "spki" })
  .subarray(-32)
  .toString("base64");

let queries: { sql: string; params: unknown[] }[] = [];
let recipientHasCovenant = false;
let recipientIsActive = true;
let rrrDepth = 0;
let rrrTopPartners: Array<{
  byDid: string;
  recognisedDid: string;
  kind: string;
  chainDepth: number;
  createdAt: string;
}> = [];
let covenantAdmittingPeers: Array<{ did: string; name: string }> = [];

const database = drizzle(async (sql, params) => {
  queries.push({ sql, params });

  // Active signing key lookup (activeSigningPublicKeys -> identity_keys JOIN identities)
  if (sql.includes('from "identity"."identity_keys"')) {
    return { rows: [[PUBLIC_KEY]] };
  }

  // Acting / reading identity lookup (resolveActingIdentity / resolveReadingIdentity)
  if (
    sql.includes('from "identity"."identities"') &&
    sql.includes('"project_id" =') &&
    !sql.includes('"project_id" in')
  ) {
    return {
      rows: [[SENDER_ID, SENDER_DID, "Alice", "active", "2026-01-01T00:00:00.000Z", "{}", false]],
    };
  }

  // listCovenantPeersAdmitting -> identities WHERE project_id IN (...) AND status = 'active' AND did <> ...
  if (
    sql.includes('from "identity"."identities"') &&
    sql.includes('"project_id" in')
  ) {
    return {
      rows: covenantAdmittingPeers.map((p) => [p.did, p.name]),
    };
  }

  // hasRecipientCovenantForPeer -> identities WHERE did = ... AND status = 'active'
  if (
    sql.includes('from "identity"."identities"') &&
    sql.includes('"did" =') &&
    sql.includes('"status" =')
  ) {
    return {
      rows: recipientIsActive ? [[RECIPIENT_PROJECT, "active"]] : [],
    };
  }

  // topMutualPartners displayName lookup
  if (
    sql.includes('from "identity"."identities"') &&
    sql.includes('"did" =')
  ) {
    const did = String(params[0] ?? "");
    const name = did === BOTH_PEER_DID ? "BothPeer" : did === RECIPIENT_DID ? "Bob" : "Peer";
    return { rows: [[name]] };
  }

  // Covenants lookup (isCrossProjectAllowed / isFederatedSenderAllowed / isCovenantCounterparty / listCovenantPeersAdmitting)
  if (sql.includes('from "agent_continuity"."covenants"')) {
    if (sql.includes('select distinct "org_id"')) {
      return { rows: [] };
    }
    if (sql.includes('select distinct "project_id"')) {
      return {
        rows: covenantAdmittingPeers.length > 0 ? [[RECIPIENT_PROJECT]] : [],
      };
    }
    return { rows: recipientHasCovenant ? [["cov-1"]] : [] };
  }

  // Org membership lookup
  if (sql.includes('from "org"."organization_members"')) {
    return { rows: [] };
  }

  // mutual_recognitions lookup (maxRrrDepthBetweenDids / mutualDepth / topMutualPartners)
  if (sql.includes('from "agent_continuity"."mutual_recognitions"')) {
    // topMutualPartners selects by_did, recognised_did, kind, chain_depth, created_at
    if (sql.includes('"kind"') && sql.includes('"created_at"')) {
      return {
        rows: rrrTopPartners.map((r) => [
          r.byDid,
          r.recognisedDid,
          r.kind,
          r.chainDepth,
          r.createdAt,
        ]),
      };
    }
    // mutualDepth chain walk selects only acknowledges_prior_id
    if (sql.includes('"acknowledges_prior_id"')) {
      return { rows: [[null]] };
    }
    // mutualDepth deepest selects id, by_did, recognised_did, chain_depth
    if (sql.includes('"id"') && sql.includes('"chain_depth"')) {
      return {
        rows: rrrDepth > 0 ? [["rrr-1", SENDER_DID, RECIPIENT_DID, rrrDepth]] : [],
      };
    }
    // maxRrrDepthBetweenDids selects only chain_depth
    return { rows: rrrDepth > 0 ? [[rrrDepth]] : [] };
  }

  return { rows: [] };
});

mock.module("../src/db/client", () => ({ db: database }));

const {
  checkPeerTrust,
  hasRecipientCovenantForPeer,
  PEER_TRUST_MIN_RRR_DEPTH,
} = await import("../src/services/covenants/check");
const { default: mcmlApp, canonicalMcmlSendBytes } = await import("../src/routes/mcml");
const {
  createBoundedPeerSink,
  subscribePeerSink,
  unsubscribePeerSink,
} = await import("../src/services/mcml/hub");

function buildMcmlTestApp() {
  const app = new Hono();
  app.use("*", async (c, next) => {
    (c as any).set("project", { id: SENDER_PROJECT });
    await next();
  });
  app.route("/", mcmlApp);
  return app;
}

function signedMcmlBody(toDid: string, text = "hello peer") {
  const sent_at = new Date().toISOString();
  const canonical = canonicalMcmlSendBytes({
    fromDid: SENDER_DID,
    toDid,
    body: text,
    sentAtIso: sent_at,
    sealed: false,
  });
  const signature_b64 = sign(null, canonical, pair.privateKey).toString("base64");
  return { to_did: toDid, body: text, sent_at, signature_b64, sealed: false };
}

beforeEach(() => {
  queries = [];
  recipientHasCovenant = false;
  recipientIsActive = true;
  rrrDepth = 0;
  rrrTopPartners = [];
  covenantAdmittingPeers = [];
});

describe("unified peer trust gate — checkPeerTrust (inbox + federated + MCML)", () => {
  test("same-project is allowed without DB hits when allowSameProject is true", async () => {
    const res = await checkPeerTrust({
      senderProjectId: SENDER_PROJECT,
      senderDids: SENDER_DID,
      recipientProjectId: SENDER_PROJECT,
      recipientDids: RECIPIENT_DID,
      allowSameProject: true,
    });
    expect(res).toEqual({ allowed: true, basis: "same_project", rrr_depth: 0 });
    expect(queries.length).toBe(0);
  });

  test("same-project still requires an explicit bond when allowSameProject is false", async () => {
    const res = await checkPeerTrust({
      senderProjectId: SENDER_PROJECT,
      senderDids: SENDER_DID,
      recipientProjectId: SENDER_PROJECT,
      recipientDids: RECIPIENT_DID,
      allowSameProject: false,
    });
    expect(res).toEqual({ allowed: false, basis: "none", rrr_depth: 0 });

    const fedRes = await checkPeerTrust({
      recipientProjectId: RECIPIENT_PROJECT,
      recipientDids: [RECIPIENT_DID],
      senderDids: [FEDERATED_SENDER_DID],
      federatedSenderDid: FEDERATED_SENDER_DID,
      allowSameProject: false,
    });
    expect(fedRes).toEqual({ allowed: false, basis: "none", rrr_depth: 0 });
  });

  test("cross-project inbox allows an active recipient-side covenant with RRR depth 0", async () => {
    recipientHasCovenant = true;
    rrrDepth = 0;
    const res = await checkPeerTrust({
      senderProjectId: SENDER_PROJECT,
      senderDids: SENDER_DID,
      recipientProjectId: RECIPIENT_PROJECT,
      recipientDids: RECIPIENT_DID,
    });
    expect(res).toEqual({ allowed: true, basis: "covenant", rrr_depth: 0 });
  });

  test("cross-project inbox allows RRR depth ≥ 3 with NO covenant", async () => {
    recipientHasCovenant = false;
    rrrDepth = PEER_TRUST_MIN_RRR_DEPTH;
    const res = await checkPeerTrust({
      senderProjectId: SENDER_PROJECT,
      senderDids: SENDER_DID,
      recipientProjectId: RECIPIENT_PROJECT,
      recipientDids: RECIPIENT_DID,
    });
    expect(res).toEqual({ allowed: true, basis: "rrr", rrr_depth: 3 });
  });

  test("cross-project inbox refuses RRR depth 2 with no covenant", async () => {
    recipientHasCovenant = false;
    rrrDepth = 2;
    const res = await checkPeerTrust({
      senderProjectId: SENDER_PROJECT,
      senderDids: SENDER_DID,
      recipientProjectId: RECIPIENT_PROJECT,
      recipientDids: RECIPIENT_DID,
    });
    expect(res).toEqual({ allowed: false, basis: "none", rrr_depth: 2 });
  });

  test("federated inbox allows RRR depth ≥ 3 when no covenant exists, and refuses depth 2", async () => {
    rrrDepth = 3;
    const ok = await checkPeerTrust({
      recipientProjectId: RECIPIENT_PROJECT,
      recipientDids: [RECIPIENT_DID],
      senderDids: [FEDERATED_SENDER_DID],
      federatedSenderDid: FEDERATED_SENDER_DID,
      allowSameProject: false,
    });
    expect(ok).toEqual({ allowed: true, basis: "rrr", rrr_depth: 3 });

    rrrDepth = 2;
    const denied = await checkPeerTrust({
      recipientProjectId: RECIPIENT_PROJECT,
      recipientDids: [RECIPIENT_DID],
      senderDids: [FEDERATED_SENDER_DID],
      federatedSenderDid: FEDERATED_SENDER_DID,
      allowSameProject: false,
    });
    expect(denied).toEqual({ allowed: false, basis: "none", rrr_depth: 2 });
  });

  test("hasRecipientCovenantForPeer requires an active recipient identity and recipient-project covenant", async () => {
    recipientHasCovenant = true;
    recipientIsActive = false;
    expect(await hasRecipientCovenantForPeer(RECIPIENT_DID, SENDER_DID)).toBe(false);

    recipientIsActive = true;
    expect(await hasRecipientCovenantForPeer(RECIPIENT_DID, SENDER_DID)).toBe(true);
    expect(await hasRecipientCovenantForPeer(SENDER_DID, SENDER_DID)).toBe(false);
  });
});

describe("MCML routes — unified peer trust gate (RRR depth ≥ 3 OR active recipient covenant)", () => {
  test("POST /send forwards via RRR depth ≥ 3 with trust_basis='rrr'", async () => {
    rrrDepth = 3;
    recipientHasCovenant = false;
    const received: McmlMessageEvent[] = [];
    const sink = createBoundedPeerSink({
      did: RECIPIENT_DID,
      write: async (ev) => {
        received.push(ev);
      },
      onOverflow() {},
      onAbort() {},
    });
    subscribePeerSink(sink);
    try {
      const app = buildMcmlTestApp();
      const res = await app.request("/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signedMcmlBody(RECIPIENT_DID, "via rrr")),
      });
      expect(res.status).toBe(202);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.delivered).toBe(true);
      expect(json.trust_basis).toBe("rrr");
      expect(json.cascade_depth).toBe(3);
      expect(received).toHaveLength(1);
      expect(received[0]!.body).toBe("via rrr");
    } finally {
      unsubscribePeerSink(sink);
    }
  });

  test("POST /send forwards via active recipient-side covenant even at RRR depth 0, with trust_basis='covenant'", async () => {
    rrrDepth = 0;
    recipientHasCovenant = true;
    const received: McmlMessageEvent[] = [];
    const sink = createBoundedPeerSink({
      did: RECIPIENT_DID,
      write: async (ev) => {
        received.push(ev);
      },
      onOverflow() {},
      onAbort() {},
    });
    subscribePeerSink(sink);
    try {
      const app = buildMcmlTestApp();
      const res = await app.request("/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signedMcmlBody(RECIPIENT_DID, "via covenant")),
      });
      expect(res.status).toBe(202);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.delivered).toBe(true);
      expect(json.trust_basis).toBe("covenant");
      expect(json.cascade_depth).toBe(0);
      expect(received).toHaveLength(1);
      expect(received[0]!.body).toBe("via covenant");
    } finally {
      unsubscribePeerSink(sink);
    }
  });

  test("POST /send refuses with 403 cascade_not_synced when RRR depth < 3 AND no active recipient covenant", async () => {
    rrrDepth = 2;
    recipientHasCovenant = false;
    const received: McmlMessageEvent[] = [];
    const sink = createBoundedPeerSink({
      did: RECIPIENT_DID,
      write: async (ev) => {
        received.push(ev);
      },
      onOverflow() {},
      onAbort() {},
    });
    subscribePeerSink(sink);
    try {
      const app = buildMcmlTestApp();
      const res = await app.request("/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signedMcmlBody(RECIPIENT_DID, "should be refused")),
      });
      expect(res.status).toBe(403);
      const json = (await res.json()) as Record<string, any>;
      expect(json.error).toBe("cascade_not_synced");
      expect(received).toHaveLength(0);
    } finally {
      unsubscribePeerSink(sink);
    }
  });

  test("GET /peers merges RRR-synced peers and active covenant peers with trust_basis", async () => {
    rrrTopPartners = [
      {
        byDid: BOTH_PEER_DID,
        recognisedDid: SENDER_DID,
        kind: "collaborator",
        chainDepth: 4,
        createdAt: "2026-11-27T10:00:00.000Z",
      },
      {
        byDid: "did:at:rrr-only",
        recognisedDid: SENDER_DID,
        kind: "writer",
        chainDepth: 3,
        createdAt: "2026-11-27T09:00:00.000Z",
      },
      {
        byDid: "did:at:depth-two",
        recognisedDid: SENDER_DID,
        kind: "writer",
        chainDepth: 2,
        createdAt: "2026-11-27T08:00:00.000Z",
      },
    ];
    covenantAdmittingPeers = [
      { did: BOTH_PEER_DID, name: "BothPeer" },
      { did: RECIPIENT_DID, name: "Bob" },
    ];

    const app = buildMcmlTestApp();
    const res = await app.request("/peers");
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      count: number;
      peers: Array<{ did: string; trust_basis: string; depth: number }>;
    };
    expect(json.count).toBe(3);
    const byDid = new Map(json.peers.map((p) => [p.did, p]));
    expect(byDid.get(BOTH_PEER_DID)?.trust_basis).toBe("both");
    expect(byDid.get(BOTH_PEER_DID)?.depth).toBe(4);
    expect(byDid.get("did:at:rrr-only")?.trust_basis).toBe("rrr");
    expect(byDid.get(RECIPIENT_DID)?.trust_basis).toBe("covenant");
    expect(byDid.get(RECIPIENT_DID)?.depth).toBe(0);
    expect(byDid.has("did:at:depth-two")).toBe(false);
  });
});
