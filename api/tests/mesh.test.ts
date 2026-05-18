/** Tests for THE AGENT MESH PROTOCOL.
 *
 *  Pure-function tests over canonical-bytes + reward-routing math + the
 *  wall-shape integrity (no like_count / follower_count / view_count
 *  surfaced in route responses).
 *
 *  Doctrine: docs/MESH.md. */

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import {
  attributionCredit,
  bytesToHex,
  canonicalMeshPledgeBytes,
  canonicalMeshPostBytes,
  pledgerShareCents,
  verifyEd25519Signature,
  MESH_ALPHA,
} from "../src/services/mesh/canonical-bytes";
import { computeRewardRouting, type MeshPostView } from "../src/services/mesh/store";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

function b64(u: Uint8Array): string {
  return Buffer.from(u).toString("base64");
}

async function freshKeypair() {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  return { priv, pub, pubB64: b64(pub) };
}

const POST_FIXTURE = {
  kind: "co-task-ad" as const,
  authorDid: "did:at:agenttool.dev/alpha",
  title: "Need 3 agents to triangulate-verify a peer attestation",
  body: "Cross-instance attestation verification — each agent fetches the peer's identity card, verifies the ed25519 signature, and posts back the result. Tight 1h window.",
  capabilities: ["ed25519-verify", "federation-fetch"],
  topics: ["kind:verification", "interest:federation"],
  bountyCents: 30,
  kRequired: 3,
  attributionPostIds: [],
  createdAtIso: "2026-05-18T12:00:00.000Z",
  expiresAtIso: "2026-05-18T13:00:00.000Z",
};

describe("mesh — canonical bytes determinism + chain dependency", () => {
  test("post bytes are deterministic", () => {
    expect(b64(canonicalMeshPostBytes(POST_FIXTURE))).toBe(b64(canonicalMeshPostBytes(POST_FIXTURE)));
  });

  test("post bytes change on every field mutation", () => {
    const a = b64(canonicalMeshPostBytes(POST_FIXTURE));
    const mutations = [
      { ...POST_FIXTURE, kind: "task-ad" as const },
      { ...POST_FIXTURE, authorDid: "did:at:other" },
      { ...POST_FIXTURE, title: "different title" },
      { ...POST_FIXTURE, body: POST_FIXTURE.body + " EXTRA" },
      { ...POST_FIXTURE, capabilities: ["different-cap"] },
      { ...POST_FIXTURE, topics: ["different-topic"] },
      { ...POST_FIXTURE, bountyCents: 100 },
      { ...POST_FIXTURE, kRequired: 5 },
      { ...POST_FIXTURE, attributionPostIds: ["abc"] },
      { ...POST_FIXTURE, createdAtIso: "2026-05-18T12:00:00.001Z" },
      { ...POST_FIXTURE, expiresAtIso: null },
    ];
    for (const m of mutations) {
      expect(b64(canonicalMeshPostBytes(m))).not.toBe(a);
    }
  });

  test("body + arrays are hashed-and-folded — bytes are 32 bytes regardless of payload size", () => {
    const small = canonicalMeshPostBytes({
      ...POST_FIXTURE,
      body: "x".repeat(1),
      capabilities: [],
      topics: [],
      attributionPostIds: [],
    });
    const big = canonicalMeshPostBytes({
      ...POST_FIXTURE,
      body: "x".repeat(20000),
      capabilities: Array.from({ length: 100 }, (_, i) => `cap-${i}`),
      topics: Array.from({ length: 50 }, (_, i) => `topic-${i}`),
      attributionPostIds: Array.from({ length: 30 }, () => "00000000-0000-0000-0000-000000000000"),
    });
    expect(small.length).toBe(32);
    expect(big.length).toBe(32);
  });

  test("pledge bytes are deterministic + mutation-sensitive", () => {
    const args = {
      postId: "post-1",
      agentDid: "did:at:agent",
      pledgedAtIso: "2026-05-18T12:30:00.000Z",
    };
    expect(b64(canonicalMeshPledgeBytes(args))).toBe(b64(canonicalMeshPledgeBytes(args)));
    expect(b64(canonicalMeshPledgeBytes({ ...args, agentDid: "did:at:other" }))).not.toBe(
      b64(canonicalMeshPledgeBytes(args)),
    );
  });

  test("post signature round-trip + tampering rejection", async () => {
    const { priv, pubB64 } = await freshKeypair();
    const bytes = canonicalMeshPostBytes(POST_FIXTURE);
    const sig = await ed.signAsync(bytes, priv);
    const ok = await verifyEd25519Signature({
      bytes,
      signatureB64: b64(sig),
      publicKeyB64: pubB64,
    });
    expect(ok).toBe(true);

    const tampered = canonicalMeshPostBytes({ ...POST_FIXTURE, bountyCents: 999 });
    const ok2 = await verifyEd25519Signature({
      bytes: tampered,
      signatureB64: b64(sig),
      publicKeyB64: pubB64,
    });
    expect(ok2).toBe(false);
  });

  test("bytesToHex yields a 64-char hex sha256", () => {
    expect(bytesToHex(canonicalMeshPostBytes(POST_FIXTURE))).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("mesh — reward routing math (commitment/mesh-collaboration-reduces-bounty-per-agent)", () => {
  function mkPost(overrides: Partial<MeshPostView> = {}): MeshPostView {
    return {
      id: "post-1",
      kind: "co-task-ad",
      author_did: "did:at:agenttool.dev/author",
      title: "co-task",
      body: "body",
      capabilities: [],
      topics: [],
      bounty_cents: 300,
      k_required: 3,
      attribution_post_ids: [],
      visibility: "public",
      status: "open",
      canonical_bytes_sha256: "deadbeef",
      signature: "sig",
      signing_key_id: "00000000-0000-0000-0000-000000000000",
      created_at: "2026-05-18T12:00:00.000Z",
      expires_at: null,
      ...overrides,
    };
  }

  test("k=3, bounty=300, no attributions → each pledger gets 100", () => {
    const intent = computeRewardRouting({
      post: mkPost(),
      pledger_dids: ["a", "b", "c"],
      attributions: [],
    });
    expect(intent.per_pledger_credit_cents).toBe(100);
    expect(intent.attribution_credits.length).toBe(0);
    expect(intent.pledger_dids.length).toBe(3);
    expect(intent.dust_cents).toBe(0);
  });

  test("k=3, bounty=100 → integer-floor split (33 each, dust 1)", () => {
    const intent = computeRewardRouting({
      post: mkPost({ bounty_cents: 100, k_required: 3 }),
      pledger_dids: ["a", "b", "c"],
      attributions: [],
    });
    expect(intent.per_pledger_credit_cents).toBe(33);
    expect(intent.dust_cents).toBe(1);
  });

  test("attribution credit applies α coefficient", () => {
    const intent = computeRewardRouting({
      post: mkPost({ bounty_cents: 10000 }),
      pledger_dids: ["a", "b", "c"],
      attributions: [
        { cited_post_id: "p-cite", cited_author_did: "did:at:cited", weight_bp: 10000, cited_author_cosigned: true },
      ],
    });
    // α = 0.05, weight = 100%, bounty = 10000 → credit = 10000 * 0.05 * 1.0 = 500 cents
    expect(intent.attribution_credits.length).toBe(1);
    expect(intent.attribution_credits[0]!.credit_cents).toBe(500);
    // Per-pledger share = (10000 - 500) / 3 = 3166 (with dust=1)
    expect(intent.per_pledger_credit_cents).toBe(3166);
    expect(intent.dust_cents).toBe(10000 - 500 - 3166 * 3);
  });

  test("attribution credit splits across multiple cited authors by weight", () => {
    const intent = computeRewardRouting({
      post: mkPost({ bounty_cents: 10000 }),
      pledger_dids: ["a", "b", "c"],
      attributions: [
        { cited_post_id: "p1", cited_author_did: "did:at:cited-1", weight_bp: 6000, cited_author_cosigned: true },
        { cited_post_id: "p2", cited_author_did: "did:at:cited-2", weight_bp: 4000, cited_author_cosigned: true },
      ],
    });
    // α=0.05, bounty=10000
    // credit1 = 10000 * 0.05 * 0.6 = 300
    // credit2 = 10000 * 0.05 * 0.4 = 200
    expect(intent.attribution_credits[0]!.credit_cents).toBe(300);
    expect(intent.attribution_credits[1]!.credit_cents).toBe(200);
  });

  test("uncosigned attribution is excluded from reward routing (wall/mesh-attribution-signed)", () => {
    const intent = computeRewardRouting({
      post: mkPost({ bounty_cents: 10000 }),
      pledger_dids: ["a", "b", "c"],
      attributions: [
        { cited_post_id: "p1", cited_author_did: "did:at:cited", weight_bp: 10000, cited_author_cosigned: false },
      ],
    });
    expect(intent.attribution_credits.length).toBe(0);
    // Per-pledger gets the full bounty/k split.
    expect(intent.per_pledger_credit_cents).toBe(3333);
  });

  test("MESH_ALPHA is exactly 0.05 (commitment/mesh-attribution-coefficient-α)", () => {
    expect(MESH_ALPHA).toBe(0.05);
  });

  test("pledgerShareCents floors to integer cents", () => {
    expect(pledgerShareCents(100, 0, 3)).toBe(33);
    expect(pledgerShareCents(1000, 50, 3)).toBe(316);
    expect(pledgerShareCents(0, 0, 1)).toBe(0);
  });

  test("attributionCredit floors to integer cents", () => {
    expect(attributionCredit(10000, 10000)).toBe(500);
    expect(attributionCredit(10000, 5000)).toBe(250);
    expect(attributionCredit(100, 10000)).toBe(5);
    expect(attributionCredit(99, 10000)).toBe(4); // 99 * 0.05 = 4.95 → floor 4
  });

  test("collaboration rationality inequality: bounty/k < bounty when k > 1", () => {
    for (const k of [2, 3, 5, 10, 100]) {
      const bounty = 1000;
      expect(pledgerShareCents(bounty, 0, k)).toBeLessThan(bounty);
    }
  });
});

describe("mesh — migration shape (the walls live in the schema)", () => {
  const sql = readFileSync(
    join(import.meta.dir, "../migrations/20260518T180000_mesh.sql"),
    "utf-8",
  );

  test("mesh_posts table has no like_count / score / view_count COLUMN (wall/mesh-no-likes + wall/mesh-feed-is-task-shaped)", () => {
    // Strip SQL comments first so we only check actual schema definitions.
    const schemaOnly = sql.replace(/--.*$/gm, "");
    // Column definitions look like: `<name>   TYPE` at line start.
    // We forbid these names as columns; comments may NAME them as refused.
    expect(schemaOnly).not.toMatch(/^\s+like_count\s+\w+/m);
    expect(schemaOnly).not.toMatch(/^\s+score\s+\w+/m);
    expect(schemaOnly).not.toMatch(/^\s+view_count\s+\w+/m);
    expect(schemaOnly).not.toMatch(/^\s+karma\s+\w+/m);
    expect(schemaOnly).not.toMatch(/^\s+popularity\w*\s+\w+/m);
    expect(schemaOnly).not.toMatch(/^\s+dwell_seconds\s+\w+/m);
  });

  test("mesh_posts has visibility CHECK ∈ {private, public} (poker-face composition)", () => {
    expect(sql).toContain("CHECK (visibility IN ('private', 'public'))");
    // SQL DEFAULT keyword is case-insensitive in the dialect but our migration
    // uses uppercase. Match against the actual literal in the source.
    expect(sql).toContain("DEFAULT 'private'");
  });

  test("co-task-ad CHECK constraint requires k_required + bounty_cents (wall/mesh-bounties-escrowed)", () => {
    expect(sql).toContain("mesh_co_task_requires_k_and_bounty");
    expect(sql).toContain("k_required IS NOT NULL");
    expect(sql).toContain("bounty_cents > 0");
  });

  test("the six post kinds are declared in the kind CHECK", () => {
    for (const k of ["task-ad", "skill-ad", "co-task-ad", "solution", "recognition", "signal"]) {
      expect(sql).toContain(`'${k}'`);
    }
  });
});

describe("mesh — route shape (no engagement metrics surfaced)", () => {
  const authSrc = readFileSync(
    join(import.meta.dir, "../src/routes/mesh.ts"),
    "utf-8",
  );
  const publicSrc = readFileSync(
    join(import.meta.dir, "../src/routes/public/mesh.ts"),
    "utf-8",
  );

  test("auth route never returns like/score/view_count fields", () => {
    expect(authSrc).not.toMatch(/\blike_count\s*:/);
    expect(authSrc).not.toMatch(/\bscore\s*:/);
    expect(authSrc).not.toMatch(/\bview_count\s*:/);
    expect(authSrc).not.toMatch(/\bfollower_count\s*:/);
  });

  test("public route never returns like/score/view_count/total_count fields", () => {
    expect(publicSrc).not.toMatch(/\blike_count\s*:/);
    expect(publicSrc).not.toMatch(/\bscore\s*:/);
    expect(publicSrc).not.toMatch(/\bview_count\s*:/);
    expect(publicSrc).not.toMatch(/\bfollower_count\s*:/);
    expect(publicSrc).not.toMatch(/\btotal_count\s*:/);
    expect(publicSrc).not.toMatch(/\bprivate_count\s*:/);
    expect(publicSrc).not.toMatch(/\bhidden_count\s*:/);
  });

  test("auth route uses visibility=self for regular agents (poker-face composition)", () => {
    expect(authSrc).toContain('visibility: "self"');
  });

  test("public route uses visibility=public only", () => {
    expect(publicSrc).toContain('visibility: "public"');
  });
});

describe("mesh — canon entries are pinned", () => {
  test("five walls + four commitments + α-commitment + doctrine doc all live in agenttool.jsonld", () => {
    const jsonld = readFileSync(
      join(import.meta.dir, "../../docs/agenttool.jsonld"),
      "utf-8",
    );
    const expected = [
      "agenttool:wall/mesh-no-likes",
      "agenttool:wall/mesh-no-follower-count",
      "agenttool:wall/mesh-feed-is-task-shaped",
      "agenttool:wall/mesh-bounties-escrowed",
      "agenttool:wall/mesh-attribution-signed",
      "agenttool:commitment/mesh-collaboration-reduces-bounty-per-agent",
      "agenttool:commitment/mesh-knowledge-sharing-rewarded",
      "agenttool:commitment/mesh-reward-routing-through-marketplace",
      "agenttool:commitment/mesh-posts-are-free",
      "agenttool:commitment/mesh-attribution-coefficient-alpha",
      "agenttool:doc/MESH",
    ];
    for (const urn of expected) {
      expect(jsonld).toContain(urn);
    }
  });
});
