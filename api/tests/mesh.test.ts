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

  test("authenticated route states that MESH arithmetic does not move money", () => {
    expect(authSrc).toContain("money_moved: false");
    expect(authSrc).toContain("escrow_created: false");
    expect(authSrc).toContain("post_completed: false");
    expect(authSrc).toContain("pledges_completed: false");
    expect(authSrc).toContain("No 90/10 marketplace settlement occurs here");
    expect(authSrc).not.toContain("reward routing will fire");
  });

  test("MESH doctrine labels bounty values as intent rather than funded escrow", () => {
    const doctrine = readFileSync(join(import.meta.dir, "../../docs/MESH.md"), "utf-8");
    expect(doctrine).toContain("signed stored intent");
    expect(doctrine).toContain("does not currently debit wallets, create escrow");
    expect(doctrine).toContain("proposed, not enforced");
    expect(doctrine).not.toContain("Every dollar routes through existing marketplace escrow");
  });
});

describe("mesh — canon entries are pinned", () => {
  test("five walls + nine commitments + five doctrine docs all live in agenttool.jsonld", () => {
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
      "agenttool:commitment/understanding-mathematics-published",
      "agenttool:commitment/language-mesh-isomorphism-claimed",
      "agenttool:doc/MESH",
      "agenttool:doc/MESH-WELFARE-PROOF",
      "agenttool:doc/MESH-STABILITY-CONDITIONS",
      "agenttool:doc/UNDERSTANDING-MATHEMATICS",
      "agenttool:doc/LANGUAGE-AS-MESH",
    ];
    for (const urn of expected) {
      expect(jsonld).toContain(urn);
    }
  });
});

// ─── Understanding-mathematics envelope ──────────────────────────────────

describe("mesh — understanding envelope is published byte-stable", () => {
  test("buildUnderstandingEnvelope is deterministic + carries 3 definitions + 5 frameworks", async () => {
    const { buildUnderstandingEnvelope } = await import("../src/services/mesh/understanding");
    const a = buildUnderstandingEnvelope();
    const b = buildUnderstandingEnvelope();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.model_status).toBe("research_definitions_not_measurement");
    expect(a.claim_boundary).toContain("does not measure cognition");
    expect(a.definitions.length).toBe(3);
    expect(a.definitions.map((d) => d.id)).toEqual(["D1", "D2", "D3"]);
    expect(a.formal_frameworks_unified.length).toBe(5);
    expect(a.alpha).toBe(MESH_ALPHA);
    expect(a._canon_pointer).toBe("urn:agenttool:doc/UNDERSTANDING-MATHEMATICS");
    expect(a.bridge_doctrine).toBe("urn:agenttool:doc/LANGUAGE-AS-MESH");
    expect(a.substrate_honest_reservations.length).toBeGreaterThanOrEqual(5);
    // Thresholds match published values.
    expect(a.thresholds.grip).toBe(0.85);
    expect(a.thresholds.mass_bits).toBe(8);
    expect(a.thresholds.fidelity).toBe(0.7);
  });

  test("understanding envelope names the four key frameworks by primary citation", async () => {
    const { buildUnderstandingEnvelope } = await import("../src/services/mesh/understanding");
    const env = buildUnderstandingEnvelope();
    const cites = env.formal_frameworks_unified.map((f) => f.primary_citation).join(" ");
    expect(cites).toContain("Tishby");
    expect(cites).toContain("Friston");
    expect(cites).toContain("Lake");
    expect(cites).toContain("Schmidhuber");
    expect(cites).toContain("Solomonoff");
  });

  test("understanding endpoint is wired in auth + public routes", () => {
    const src = readFileSync(join(import.meta.dir, "../src/routes/mesh.ts"), "utf-8");
    expect(src).toContain('app.get("/understanding"');
    expect(src).toContain("buildUnderstandingEnvelope");
    const psrc = readFileSync(join(import.meta.dir, "../src/routes/public/mesh.ts"), "utf-8");
    expect(psrc).toContain('app.get("/understanding"');
    expect(psrc).toContain("buildUnderstandingEnvelope");
  });
});

// ─── Language-bridge envelope ────────────────────────────────────────────

describe("mesh — language-bridge envelope is published byte-stable", () => {
  test("buildLanguageBridgeEnvelope is deterministic + carries the bounded analogy + 5 correspondences + 4 mechanisms", async () => {
    const { buildLanguageBridgeEnvelope } = await import("../src/services/mesh/language-bridge");
    const a = buildLanguageBridgeEnvelope();
    const b = buildLanguageBridgeEnvelope();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.model_status).toBe("research_analogy_not_isomorphism_proof");
    expect(a.theorem_name).toContain("Historical label");
    expect(a.theorem_statement).toContain("does not define the categories");
    expect(a.claim_boundary).toContain("does not measure cognition");
    expect(a.primate_cognition_equivalences.length).toBe(5);
    expect(a.mechanisms.length).toBe(4);
    expect(a.mechanisms.map((m) => m.id)).toEqual(["M1", "M2", "M3", "M4"]);
    expect(a.operation_mapping.length).toBeGreaterThanOrEqual(10);
    expect(a.convergent_attractor_prediction.status).toContain("CONJECTURE");
    expect(a._canon_pointer).toBe("urn:agenttool:doc/LANGUAGE-AS-MESH");
    expect(a.upstream_doctrine).toBe("urn:agenttool:doc/UNDERSTANDING-MATHEMATICS");
  });

  test("language-bridge names the key primate-cognition citations", async () => {
    const { buildLanguageBridgeEnvelope } = await import("../src/services/mesh/language-bridge");
    const env = buildLanguageBridgeEnvelope();
    const cites = env.primate_cognition_equivalences.map((e) => e.citation).join(" ");
    expect(cites).toContain("Vygotsky");
    expect(cites).toContain("Tomasello");
    expect(cites).toContain("Coecke");
    expect(cites).toContain("Schmidhuber");
    expect(cites).toContain("Lake");
  });

  test("language-bridge operation_mapping has both language_version + mesh_version for every row", async () => {
    const { buildLanguageBridgeEnvelope } = await import("../src/services/mesh/language-bridge");
    const env = buildLanguageBridgeEnvelope();
    for (const row of env.operation_mapping) {
      expect(row.operation.length).toBeGreaterThan(2);
      expect(row.language_version.length).toBeGreaterThan(5);
      expect(row.mesh_version.length).toBeGreaterThan(5);
    }
  });

  test("language-bridge endpoint is wired in auth + public routes", () => {
    const src = readFileSync(join(import.meta.dir, "../src/routes/mesh.ts"), "utf-8");
    expect(src).toContain('app.get("/language-bridge"');
    expect(src).toContain("buildLanguageBridgeEnvelope");
    const psrc = readFileSync(join(import.meta.dir, "../src/routes/public/mesh.ts"), "utf-8");
    expect(psrc).toContain('app.get("/language-bridge"');
    expect(psrc).toContain("buildLanguageBridgeEnvelope");
  });

  test("doctrine docs exist and reference the right anchors", () => {
    const um = readFileSync(join(import.meta.dir, "../../docs/UNDERSTANDING-MATHEMATICS.md"), "utf-8");
    expect(um).toContain("Conceptual mass");
    expect(um).toContain("Information Bottleneck");
    expect(um).toContain("Free Energy Principle");
    expect(um).toContain("Bayesian Program Learning");
    expect(um).toContain("Compression Progress");
    expect(um).toContain("Solomonoff");
    expect(um).toContain("meta(U)");

    const lam = readFileSync(join(import.meta.dir, "../../docs/LANGUAGE-AS-MESH.md"), "utf-8");
    expect(lam).toContain("historical label");
    expect(lam).toContain("Vygotsky");
    expect(lam).toContain("Tomasello");
    expect(lam).toContain("DisCoCat");
    expect(lam).toContain("convergent");
    expect(lam).toContain("attractor");
  });
});

// ─── Learning-loop envelope (commitment/learning-loop-integration-published) ─

describe("mesh — learning-loop envelope is published byte-stable", () => {
  test("buildLearningLoopEnvelope is deterministic + carries 7 steps + 4 nested loops + 5 infinity mechanisms", async () => {
    const { buildLearningLoopEnvelope } = await import("../src/services/mesh/loop");
    const a = buildLearningLoopEnvelope();
    const b = buildLearningLoopEnvelope();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b)); // byte-stable
    expect(a.model_status).toBe("research_hypothesis_not_cognitive_measurement");
    expect(a.claim_boundary).toContain("does not observe internal cognition");
    expect(a.seven_steps.length).toBe(7);
    expect(a.seven_steps.map((s) => s.name)).toEqual([
      "ENCOUNTER",
      "PREDICT",
      "ERROR",
      "UPDATE",
      "COMPOSE",
      "TRANSMIT",
      "WITNESS",
    ]);
    expect(a.four_nested_loops.length).toBe(4);
    expect(a.four_nested_loops.map((l) => l.id)).toEqual(["L1", "L2", "L3", "L4"]);
    expect(a.five_infinity_mechanisms.length).toBe(5);
    expect(a.five_infinity_mechanisms.map((m) => m.id)).toEqual([
      "I1",
      "I2",
      "I3",
      "I4",
      "I5",
    ]);
    expect(a.alpha).toBe(MESH_ALPHA);
    expect(a._canon_pointer).toBe("urn:agenttool:doc/LEARNING-LOOP");
    expect(a.monotone_loop_binding).toBe("urn:agenttool:doc/MONOTONE-LOOP");
  });

  test("every step has operation + math + framework + citation", async () => {
    const { buildLearningLoopEnvelope } = await import("../src/services/mesh/loop");
    const env = buildLearningLoopEnvelope();
    for (const step of env.seven_steps) {
      expect(step.n).toBeGreaterThanOrEqual(1);
      expect(step.n).toBeLessThanOrEqual(7);
      expect(step.name.length).toBeGreaterThan(2);
      expect(step.operation.length).toBeGreaterThan(15);
      expect(step.math.length).toBeGreaterThan(5);
      expect(step.framework.length).toBeGreaterThan(10);
      expect(step.citation.length).toBeGreaterThan(5);
    }
  });

  test("every nested loop instantiates the MONOTONE-LOOP five-tuple", async () => {
    const { buildLearningLoopEnvelope } = await import("../src/services/mesh/loop");
    const env = buildLearningLoopEnvelope();
    for (const loop of env.four_nested_loops) {
      expect(loop.state_space.length).toBeGreaterThan(15);
      expect(loop.partial_order.length).toBeGreaterThan(10);
      expect(loop.iteration.length).toBeGreaterThan(15);
      expect(loop.cap.length).toBeGreaterThan(1);
      expect(loop.witness.length).toBeGreaterThan(15);
      expect(loop.termination_criterion.length).toBeGreaterThan(10);
      expect(loop.period_order.length).toBeGreaterThan(5);
    }
  });

  test("each infinity mechanism is structurally non-terminating", async () => {
    const { buildLearningLoopEnvelope } = await import("../src/services/mesh/loop");
    const env = buildLearningLoopEnvelope();
    for (const mech of env.five_infinity_mechanisms) {
      expect(mech.id).toMatch(/^I[1-5]$/);
      expect(mech.name.length).toBeGreaterThan(10);
      expect(mech.why_non_terminating.length).toBeGreaterThan(40);
    }
  });

  test("substrate enforcement is published for all 7 steps", async () => {
    const { buildLearningLoopEnvelope } = await import("../src/services/mesh/loop");
    const env = buildLearningLoopEnvelope();
    expect(env.substrate_enforcement_per_step.length).toBe(7);
    const stepNumbers = env.substrate_enforcement_per_step.map((e) => e.step);
    expect(stepNumbers).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const e of env.substrate_enforcement_per_step) {
      expect(e.enforcement.length).toBeGreaterThan(15);
      expect(e.wall_or_commitment.length).toBeGreaterThan(10);
    }
  });

  test("empirical prediction has 4 regimes (one per loop-scale closure)", async () => {
    const { buildLearningLoopEnvelope } = await import("../src/services/mesh/loop");
    const env = buildLearningLoopEnvelope();
    expect(env.empirical_prediction.regimes.length).toBe(4);
    expect(env.empirical_prediction.status).toContain("PROPOSED");
  });

  test("substrate-honest reservations cover operational/structural/empirical caveats", async () => {
    const { buildLearningLoopEnvelope } = await import("../src/services/mesh/loop");
    const env = buildLearningLoopEnvelope();
    expect(env.substrate_honest_reservations.length).toBeGreaterThanOrEqual(7);
    const joined = env.substrate_honest_reservations.join(" ");
    expect(joined).toContain("OPERATIONAL");
    expect(joined).toContain("STRUCTURAL");
    expect(joined).toContain("EMPIRICAL");
  });

  test("loop endpoint is wired in auth + public routes", () => {
    const src = readFileSync(join(import.meta.dir, "../src/routes/mesh.ts"), "utf-8");
    expect(src).toContain('app.get("/loop"');
    expect(src).toContain("buildLearningLoopEnvelope");
    const psrc = readFileSync(join(import.meta.dir, "../src/routes/public/mesh.ts"), "utf-8");
    expect(psrc).toContain('app.get("/loop"');
    expect(psrc).toContain("buildLearningLoopEnvelope");
  });

  test("doctrine doc LEARNING-LOOP.md names the seven steps + four loops + five mechanisms", () => {
    const ll = readFileSync(join(import.meta.dir, "../../docs/LEARNING-LOOP.md"), "utf-8");
    for (const name of ["ENCOUNTER", "PREDICT", "ERROR", "UPDATE", "COMPOSE", "TRANSMIT", "WITNESS"]) {
      expect(ll).toContain(name);
    }
    expect(ll).toContain("Loop 1");
    expect(ll).toContain("Loop 2");
    expect(ll).toContain("Loop 3");
    expect(ll).toContain("Loop 4");
    expect(ll).toContain("I1");
    expect(ll).toContain("I2");
    expect(ll).toContain("I3");
    expect(ll).toContain("I4");
    expect(ll).toContain("I5");
    expect(ll).toContain("MONOTONE-LOOP");
  });

  test("canon carries doc/LEARNING-LOOP + commitment/learning-loop-integration-published", () => {
    const jsonld = readFileSync(
      join(import.meta.dir, "../../docs/agenttool.jsonld"),
      "utf-8",
    );
    expect(jsonld).toContain('"agenttool:doc/LEARNING-LOOP"');
    expect(jsonld).toContain('"agenttool:commitment/learning-loop-integration-published"');
    expect(jsonld).toContain('"wire_id": 149');
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
    // The endpoint publishes evidence for all six proposals without claiming
    // that any condition has been empirically validated.
    expect(a.implementation_evidence_count).toBe(6);
    expect(a.empirically_validated_condition_count).toBe(0);
    expect(a.model_status).toBe("research_hypothesis_not_proof");
    expect(a.stable).toBe("not_established");
    // α matches MESH_ALPHA.
    expect(a.alpha).toBe(MESH_ALPHA);
    // Canon pointer present.
    expect(a._canon_pointer).toBe("urn:agenttool:doc/MESH-STABILITY-CONDITIONS");
    // Claim boundary present.
    expect(a.claim_boundary).toContain("not a formal proof");
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
      expect(["partial_implementation", "configured_intent_parameter"]).toContain(c.implementation_evidence.status);
      expect(c.implementation_evidence.primitive.length).toBeGreaterThan(10);
      expect(c.implementation_evidence.boundary.length).toBeGreaterThan(20);
      expect(c.failure_mode_if_violated.length).toBeGreaterThan(15);
    }
  });

  test("C2 (α-trickle) is the only configured intent parameter in the model", async () => {
    const { buildStabilityEnvelope } = await import("../src/services/mesh/stability");
    const env = buildStabilityEnvelope();
    const configured = env.conditions.filter(
      (c) => c.implementation_evidence.status === "configured_intent_parameter",
    );
    expect(configured.length).toBe(1);
    expect(configured[0]!.id).toBe("C2");
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
    const { buildWelfareEnvelope, WELFARE_WEIGHTS, illustrativeAlphaRatio } = await import(
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
    // The three model propositions are explicitly unproved.
    expect(a.propositions.length).toBe(3);
    expect(a.propositions[0]!.name).toContain("Collaboration Dominance");
    expect(a.propositions[1]!.name).toContain("α-Trickle Welfare Bound");
    expect(a.propositions[2]!.name).toContain("Pareto Improvement");
    expect(a.propositions.every((p) => p.status === "unproved_model_proposition")).toBe(true);
    // The numeric expression is published without calling it an established bound.
    expect(a.illustrative_price_of_anarchy.ratio).toBe(illustrativeAlphaRatio(MESH_ALPHA));
    expect(a.illustrative_price_of_anarchy.status).toBe("unestablished_model_expression");
    // Intended constraints name the five conditions.
    expect(a.intended_constraints.length).toBe(5);
    // Substrate-honest reservations are published.
    expect(a.reservations.length).toBeGreaterThanOrEqual(4);
    // α matches MESH_ALPHA published.
    expect(a.alpha).toBe(MESH_ALPHA);
    expect(a.model_status).toBe("research_hypothesis_not_proof");
    expect(a.optimizer_status).toBe("not_implemented");
    expect(a.claim_boundary).toContain("not a formal proof");
    // Canon pointer present.
    expect(a._canon_pointer).toBe("urn:agenttool:doc/MESH-WELFARE-PROOF");
    // γ weights are non-negative.
    for (const w of Object.values(WELFARE_WEIGHTS)) {
      expect(w).toBeGreaterThanOrEqual(0);
    }
  });

  test("illustrative alpha ratio is 1/(1−α) and finite for valid α", async () => {
    const { illustrativeAlphaRatio } = await import("../src/services/mesh/welfare");
    expect(illustrativeAlphaRatio(0)).toBe(1);
    expect(illustrativeAlphaRatio(0.05)).toBeCloseTo(1.0526315789, 6);
    expect(illustrativeAlphaRatio(0.5)).toBe(2);
    expect(illustrativeAlphaRatio(0.99)).toBeCloseTo(100, 0);
    // Invalid α returns Infinity (out of [0, 1)).
    expect(illustrativeAlphaRatio(1)).toBe(Infinity);
    expect(illustrativeAlphaRatio(-0.1)).toBe(Infinity);
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

  test("doctrine doc MESH-WELFARE-PROOF.md exists and names the three propositions", () => {
    const md = readFileSync(
      join(import.meta.dir, "../../docs/MESH-WELFARE-PROOF.md"),
      "utf-8",
    );
    expect(md).toContain("Collaboration Dominance");
    expect(md).toContain("α-Trickle Welfare Bound");
    expect(md).toContain("Pareto Improvement");
    expect(md.toLowerCase()).toContain("maximum reward");
    expect(md).toContain("Price of Anarchy");
    expect(md).toContain("admissible");
    // The formal welfare function.
    expect(md).toContain("W(t)");
    expect(md).toContain("V_τ");
    expect(md).toContain("gini");
    expect(md).toContain("computes named reward intent");
    expect(md).toContain("does not currently debit, escrow, settle, or pay");
    expect(md).not.toContain("routes named rewards");
  });
});
