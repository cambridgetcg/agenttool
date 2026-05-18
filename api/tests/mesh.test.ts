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
  test("five walls + seven commitments + three doctrine docs all live in agenttool.jsonld", () => {
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
      "agenttool:commitment/mesh-welfare-maximization-published",
      "agenttool:commitment/mesh-stability-conditions-published",
      "agenttool:doc/MESH",
      "agenttool:doc/MESH-WELFARE-PROOF",
      "agenttool:doc/MESH-STABILITY-CONDITIONS",
    ];
    for (const urn of expected) {
      expect(jsonld).toContain(urn);
    }
  });
});

// ─── Stability conditions envelope (commitment/mesh-stability-conditions-published) ─

describe("mesh — stability envelope is published byte-stable", () => {
  test("buildStabilityEnvelope is deterministic + carries six conditions + three threshold layers", async () => {
    const { buildStabilityEnvelope } = await import("../src/services/mesh/stability");
    const a = buildStabilityEnvelope();
    const b = buildStabilityEnvelope();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b)); // byte-stable
    // Six conditions.
    expect(a.conditions.length).toBe(6);
    const ids = a.conditions.map((c) => c.id);
    expect(ids).toEqual(["C1", "C2", "C3", "C4", "C5", "C6"]);
    // Three threshold layers.
    expect(a.threshold_layers.length).toBe(3);
    expect(a.threshold_layers.map((l) => l.id)).toEqual(["L0", "L1", "L2"]);
    // Five stability sub-properties.
    expect(a.stability_sub_properties.length).toBe(5);
    expect(a.stability_sub_properties.map((s) => s.id)).toEqual(["S1", "S2", "S3", "S4", "S5"]);
    // Counts: 5 structural + 1 operational.
    expect(a.structurally_enforced_count).toBe(5);
    expect(a.operationally_retunable_count).toBe(1);
    // α matches MESH_ALPHA.
    expect(a.alpha).toBe(MESH_ALPHA);
    // Canon pointer present.
    expect(a._canon_pointer).toBe("urn:agenttool:doc/MESH-STABILITY-CONDITIONS");
    // Disclaimer present.
    expect(a.unconditional_stability_disclaimer).toContain("UNCONDITIONAL");
    // Open empirical questions present.
    expect(a.open_empirical_questions.length).toBeGreaterThanOrEqual(5);
  });

  test("every condition has all required fields (literature_equivalent + substrate_enforcement + failure_mode)", async () => {
    const { buildStabilityEnvelope } = await import("../src/services/mesh/stability");
    const env = buildStabilityEnvelope();
    for (const c of env.conditions) {
      expect(c.id).toMatch(/^C[1-6]$/);
      expect(c.statement.length).toBeGreaterThan(20);
      expect(c.stability_sub_properties_implied.length).toBeGreaterThanOrEqual(1);
      expect(c.literature_equivalent.name.length).toBeGreaterThan(5);
      expect(c.literature_equivalent.primary_citation.length).toBeGreaterThan(5);
      expect(c.literature_equivalent.key_result.length).toBeGreaterThan(20);
      expect(["structural", "operational"]).toContain(c.substrate_enforcement.mechanism);
      expect(c.substrate_enforcement.primitive.length).toBeGreaterThan(10);
      expect(c.failure_mode_if_violated.length).toBeGreaterThan(15);
    }
  });

  test("C2 (α-trickle) is the ONLY operationally re-tunable condition", async () => {
    const { buildStabilityEnvelope } = await import("../src/services/mesh/stability");
    const env = buildStabilityEnvelope();
    const operational = env.conditions.filter(
      (c) => c.substrate_enforcement.mechanism === "operational",
    );
    expect(operational.length).toBe(1);
    expect(operational[0]!.id).toBe("C2");
  });

  test("stability endpoint is wired in the auth route", () => {
    const src = readFileSync(
      join(import.meta.dir, "../src/routes/mesh.ts"),
      "utf-8",
    );
    expect(src).toContain('app.get("/stability"');
    expect(src).toContain("buildStabilityEnvelope");
  });

  test("stability endpoint is wired in the public route", () => {
    const src = readFileSync(
      join(import.meta.dir, "../src/routes/public/mesh.ts"),
      "utf-8",
    );
    expect(src).toContain('app.get("/stability"');
    expect(src).toContain("buildStabilityEnvelope");
  });

  test("doctrine doc MESH-STABILITY-CONDITIONS.md names the six conditions + the literature equivalents", () => {
    const md = readFileSync(
      join(import.meta.dir, "../../docs/MESH-STABILITY-CONDITIONS.md"),
      "utf-8",
    );
    for (const cid of ["C1", "C2", "C3", "C4", "C5", "C6"]) {
      expect(md).toContain(cid);
    }
    expect(md).toContain("Mean-field game");
    expect(md).toContain("Pigou");
    expect(md).toContain("Vickrey");
    expect(md).toContain("Folk Theorem");
    expect(md).toContain("Sybil");
    expect(md).toContain("1/N convergence");
    expect(md).toContain("L0");
    expect(md).toContain("L1");
    expect(md).toContain("L2");
  });
});

// ─── Welfare function publication (commitment/mesh-welfare-maximization-published) ─

describe("mesh — welfare envelope is published byte-stable", () => {
  test("buildWelfareEnvelope is deterministic + carries all six terms", async () => {
    const { buildWelfareEnvelope, WELFARE_WEIGHTS, priceOfAnarchyBound } = await import(
      "../src/services/mesh/welfare"
    );
    const a = buildWelfareEnvelope();
    const b = buildWelfareEnvelope();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b)); // byte-stable
    // The five welfare-function terms.
    expect(a.welfare_function.terms.length).toBe(5);
    const symbols = a.welfare_function.terms.map((t) => t.symbol);
    expect(symbols).toContain("Σ V_τ");
    expect(symbols).toContain("Σ Δw_a");
    expect(symbols).toContain("Σ citation_count(s)");
    expect(symbols).toContain("Σ e_a · (1 − p_a)");
    expect(symbols).toContain("gini(payouts)");
    // The three theorems.
    expect(a.theorems.length).toBe(3);
    expect(a.theorems[0]!.name).toContain("Collaboration Dominance");
    expect(a.theorems[1]!.name).toContain("α-Trickle Welfare Bound");
    expect(a.theorems[2]!.name).toContain("Pareto Improvement");
    // PoA bound matches the published formula.
    expect(a.price_of_anarchy.bound).toBe(priceOfAnarchyBound(MESH_ALPHA));
    expect(a.price_of_anarchy.bound).toBeCloseTo(1 / (1 - MESH_ALPHA), 6);
    expect(a.price_of_anarchy.gap_at_optimum_percent).toBeLessThan(6);
    // Admissible class names the five conditions.
    expect(a.admissible_class.length).toBe(5);
    // Substrate-honest reservations are published.
    expect(a.reservations.length).toBeGreaterThanOrEqual(4);
    // α matches MESH_ALPHA published.
    expect(a.alpha).toBe(MESH_ALPHA);
    // Canon pointer present.
    expect(a._canon_pointer).toBe("urn:agenttool:doc/MESH-WELFARE-PROOF");
    // γ weights are non-negative.
    for (const w of Object.values(WELFARE_WEIGHTS)) {
      expect(w).toBeGreaterThanOrEqual(0);
    }
  });

  test("Price-of-Anarchy bound is 1/(1−α) and finite for valid α", async () => {
    const { priceOfAnarchyBound } = await import("../src/services/mesh/welfare");
    expect(priceOfAnarchyBound(0)).toBe(1);
    expect(priceOfAnarchyBound(0.05)).toBeCloseTo(1.0526315789, 6);
    expect(priceOfAnarchyBound(0.5)).toBe(2);
    expect(priceOfAnarchyBound(0.99)).toBeCloseTo(100, 0);
    // Invalid α returns Infinity (out of [0, 1)).
    expect(priceOfAnarchyBound(1)).toBe(Infinity);
    expect(priceOfAnarchyBound(-0.1)).toBe(Infinity);
  });

  test("welfare endpoint is wired in the auth route", () => {
    const src = readFileSync(
      join(import.meta.dir, "../src/routes/mesh.ts"),
      "utf-8",
    );
    expect(src).toContain('app.get("/welfare"');
    expect(src).toContain("buildWelfareEnvelope");
  });

  test("welfare endpoint is wired in the public route", () => {
    const src = readFileSync(
      join(import.meta.dir, "../src/routes/public/mesh.ts"),
      "utf-8",
    );
    expect(src).toContain('app.get("/welfare"');
    expect(src).toContain("buildWelfareEnvelope");
  });

  test("doctrine doc MESH-WELFARE-PROOF.md exists and names the three theorems", () => {
    const md = readFileSync(
      join(import.meta.dir, "../../docs/MESH-WELFARE-PROOF.md"),
      "utf-8",
    );
    expect(md).toContain("Collaboration Dominance");
    expect(md).toContain("α-Trickle Welfare Bound");
    expect(md).toContain("Pareto Improvement");
    expect(md).toContain("Maximum Reward");
    expect(md).toContain("Price of Anarchy");
    expect(md).toContain("admissible");
    // The formal welfare function.
    expect(md).toContain("W(t)");
    expect(md).toContain("V_τ");
    expect(md).toContain("gini");
  });
});
