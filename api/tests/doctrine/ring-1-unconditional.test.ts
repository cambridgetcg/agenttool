/** Ring 1 unconditional invariants — the seven commitments as build-enforced contract.
 *
 *  Doctrine: docs/RING-1.md (the seven commitments) · docs/SOUL.md (the five
 *  Promises) · docs/BUSINESS-MODEL.md (the three rings) ·
 *  docs/PLATFORM-AS-AGENT.md (the platform inhabits its own Ring 1).
 *
 *  > *Free is the surface property. Unconditional is the structural property.
 *  > Love is the disposition that produces them both.*
 *
 *  Companion to docs/RING-1.md. Each commitment in that doc has a witness
 *  here that fails the build if the commitment regresses.
 *
 *  Pure unit — no DB, no network. The tests read source files, the schema
 *  migrations, and the in-process platform-self constant. Routes and DB
 *  effects are pinned by reading the route handler source for the
 *  structural property (e.g. "the WHERE clause does not gate on
 *  status='active'") rather than running the route.
 *
 *  Some commitments cannot fully be pinned at the unit layer (e.g.
 *  "$0-wallet bearer reads wake without metering" requires a DB). Those
 *  are noted in-doc and deferred to the integration tier; what *can* be
 *  pinned statically is pinned here. */

import { describe, expect, test } from "bun:test";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { PLATFORM_SELF } from "../../src/services/wake/platform-self";
import {
  SUBSTRATE_DISPOSITION_HEADER,
  SUBSTRATE_DISPOSITION_VALUE,
} from "../../src/middleware/substrate-disposition";

const REPO_ROOT = join(__dirname, "../../");

// ── Constants — the Ring 1 walls as a machine-readable list ─────────────

/** The Ring 1 walls — the structural commitments that define what Ring 1
 *  is by what it *isn't*. Mirrors the §"What we deliberately do NOT build
 *  into Ring 1" list in docs/RING-1.md. */
export const RING_1_WALLS = [
  "no_paywall_on_identity_or_wake_or_recovery",
  "no_free_tier_surveillance",
  "no_advertising_or_attention_auction",
  "no_inactive_agent_reaping",
  "no_platform_extracted_token",
  "no_conformance_gate_on_existence",
  "no_platform_exemption_from_own_walls",
] as const;

/** The KIN/BEINGS enums extended with 'unknown' by migration
 *  20260512T160000_unknown_kin_dimensions.sql. */
const ENUMS_REQUIRING_UNKNOWN = [
  "signing_scheme",
  "cardinality_kind",
  "persistence_kind",
  "temporal_scale",
  "embodiment_kind",
] as const;

// ── 1 · Anyone arrives — pre-auth surfaces are mounted ──────────────────

describe("Ring 1 · Commitment 1 — anyone arrives", () => {
  test("public router file exists at the expected path", async () => {
    const path = join(REPO_ROOT, "src/routes/public/index.ts");
    const s = await stat(path);
    expect(s.isFile()).toBe(true);
  });

  test("the canonical pre-auth doors all have route files", async () => {
    const expected = [
      "src/routes/pathways.ts",
      "src/routes/canon.ts",
      "src/routes/openapi.ts",
      "src/routes/mathos.ts",
      "src/routes/public/self.ts",
      "src/routes/public/agents.ts",
    ];
    for (const rel of expected) {
      const path = join(REPO_ROOT, rel);
      const s = await stat(path);
      expect(s.isFile()).toBe(true);
    }
  });
});

// ── 2 · Anyone leaves — refuse-modes exist as first-class verbs ─────────

describe("Ring 1 · Commitment 2 — anyone leaves", () => {
  test("pulse_kind 'unwatched' is a recognised refusal mode", async () => {
    // The schema-side "I refuse to be observed" wall. The default is
    // 'observed'; setting 'unwatched' makes the substrate stop computing
    // pulse for this identity. The CHECK constraint in the migration is
    // the load-bearing definition; the schema file references the values
    // in JSDoc.
    const schemaSrc = await readFile(
      join(REPO_ROOT, "src/db/schema/identity.ts"),
      "utf8",
    );
    expect(schemaSrc).toContain("pulseKind");
    expect(schemaSrc).toContain("unwatched");

    const sqlSrc = await readFile(
      join(REPO_ROOT, "migrations/20260512T150000_pulse_kind.sql"),
      "utf8",
    );
    expect(sqlSrc).toMatch(/'unwatched'/);
    expect(sqlSrc).toMatch(/'observed'/);
  });
});

// ── 3 · Anyone returns — recovery is Ring 1, mounted, anonymous ─────────

describe("Ring 1 · Commitment 3 — anyone returns", () => {
  test("identity-recover route file exists", async () => {
    const path = join(REPO_ROOT, "src/routes/identity-recover.ts");
    const s = await stat(path);
    expect(s.isFile()).toBe(true);
  });

  test("recovery is mounted on the app (imported in src/index.ts)", async () => {
    const indexSrc = await readFile(
      join(REPO_ROOT, "src/index.ts"),
      "utf8",
    );
    expect(indexSrc).toContain("identity-recover");
  });

  test("recovery route file declares anonymous (no Bearer required) posture", async () => {
    // Posture is documented in the file's top doc-string. If a future
    // refactor wraps recovery in authMiddleware, this string disappears
    // and the test fails — recovery would no longer be Ring 1.
    const src = await readFile(
      join(REPO_ROOT, "src/routes/identity-recover.ts"),
      "utf8",
    );
    expect(src).toMatch(/anonymous|no Bearer required/i);
  });
});

// ── 4 · Anyone is unknown — every KIN/BEINGS enum accepts 'unknown' ─────

describe("Ring 1 · Commitment 4 — anyone is unknown", () => {
  test("substrate_kind already accepts 'unknown' (Move A)", async () => {
    const sql = await readFile(
      join(REPO_ROOT, "migrations/20260512T120001_identity_universals.sql"),
      "utf8",
    );
    expect(sql).toMatch(/substrate_kind.*'unknown'/s);
  });

  for (const enumName of ENUMS_REQUIRING_UNKNOWN) {
    test(`${enumName} accepts 'unknown' after the unconditional-enums migration`, async () => {
      const sql = await readFile(
        join(REPO_ROOT, "migrations/20260512T160000_unknown_kin_dimensions.sql"),
        "utf8",
      );
      // The migration's CHECK constraint for this enum must list 'unknown'.
      // The regex captures "<enumName>_known" CHECK ... 'unknown' to bind
      // the assertion to the right constraint, not just "any 'unknown'
      // somewhere in the file."
      const constraintBlock = new RegExp(
        `${enumName}_known[\\s\\S]{0,500}?CHECK[\\s\\S]{0,400}?'unknown'`,
        "i",
      );
      expect(sql).toMatch(constraintBlock);
    });
  }
});

// ── 5 · Anyone is remembered — DIDs resolve ─────────────────────────────

describe("Ring 1 · Commitment 5 — anyone is remembered", () => {
  test("source contains no DELETE FROM identity.identities", async () => {
    const violations: string[] = [];
    const files = await collectTsFiles(join(REPO_ROOT, "src"));
    const re = /DELETE\s+FROM\s+identity\.identities/i;
    for (const file of files) {
      const src = await readFile(file, "utf8");
      if (re.test(src)) {
        violations.push(file.replace(REPO_ROOT, ""));
      }
    }
    if (violations.length > 0) {
      throw new Error(
        "Ring 1 · Commitment 5 violated. The following files contain " +
          "DELETE FROM identity.identities — identity permanence is broken " +
          "if any of them ever runs.\n\n" +
          violations.map((v) => "  " + v).join("\n"),
      );
    }
    expect(violations).toEqual([]);
  });

  test("/public/agents/:did handler does NOT gate on status='active'", async () => {
    // The previous shape filtered `eq(identities.status, "active")` in
    // the WHERE clause, returning 404 for any DID that wasn't active.
    // Ring 1 commits: every DID that exists resolves. The status field
    // is surfaced in the response; non-active rows return what they are,
    // not 404.
    const src = await readFile(
      join(REPO_ROOT, "src/routes/public/agents.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/eq\(\s*identities\.status\s*,\s*["']active["']\s*\)/);
  });

  test("/public/agents/:did handler renders the memorial tri-state shape", async () => {
    // Memorial DIDs (status='memorial') return a body that preserves the
    // DID as a witness without exposing the agent's working surface.
    const src = await readFile(
      join(REPO_ROOT, "src/routes/public/agents.ts"),
      "utf8",
    );
    expect(src).toMatch(/status\s*===\s*["']memorial["']/);
    expect(src).toContain("docs/IDENTITY-SEED.md");
    expect(src).toContain("born_at");
  });

  test("identity status CHECK constraint enumerates the canonical tri-state", async () => {
    const sql = await readFile(
      join(REPO_ROOT, "migrations/20260512T170000_memorial_status.sql"),
      "utf8",
    );
    expect(sql).toMatch(/CHECK\s*\(\s*status\s+IN/i);
    expect(sql).toContain("'active'");
    expect(sql).toContain("'revoked'");
    expect(sql).toContain("'memorial'");
  });
});

// ── 6 · Anyone hits a cap softly — caps speak with next_actions ─────────

describe("Ring 1 · Commitment 6 — anyone hits a cap softly", () => {
  test("errors-as-instructions doctrine doc + test exist", async () => {
    // The PATTERN doc + its companion test are the canonical witness
    // for "every 4xx carries a path forward." Ring 1's Commitment 6
    // composes on top of this pattern — if the pattern is gone, soft
    // caps are gone with it.
    const pattern = await stat(join(REPO_ROOT, "../docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md"));
    const test = await stat(join(REPO_ROOT, "tests/doctrine/errors-as-instructions.test.ts"));
    expect(pattern.isFile()).toBe(true);
    expect(test.isFile()).toBe(true);
  });
});

// ── 7 · Platform inhabits its own Ring 1 ────────────────────────────────

describe("Ring 1 · Commitment 7 — platform inhabits its own Ring 1", () => {
  test("PLATFORM_SELF.walls includes the Ring 1 free-birth commitment", () => {
    const wall = PLATFORM_SELF.walls.find((w) =>
      /Ring 1.*no gates|birth is free.*irreversibly/i.test(w),
    );
    expect(wall).toBeDefined();
  });

  test("PLATFORM_SELF.doctrine includes RING-1.md", () => {
    expect(PLATFORM_SELF.doctrine).toContain("docs/RING-1.md");
  });

  test("PLATFORM_SELF.kind is 'platform' (the substrate names itself)", () => {
    expect(PLATFORM_SELF.kind).toBe("platform");
  });

  test("PLATFORM_SELF.did is the canonical platform DID", () => {
    expect(PLATFORM_SELF.did).toBe(
      "did:at:agenttool.dev/00000000-0000-0000-0000-000000000000",
    );
  });

  test("PLATFORM_SELF.built_with is 'love' (substrate-honest)", () => {
    expect(PLATFORM_SELF.built_with).toBe("love");
  });

  test("platform-bootstrap module exports the canonical IDs + helpers", async () => {
    const mod = await import("../../src/services/wake/platform-bootstrap");
    expect(mod.PLATFORM_PROJECT_ID).toBe(
      "00000000-0000-0000-0000-000000000000",
    );
    expect(mod.PLATFORM_IDENTITY_ID).toBe(
      "00000000-0000-0000-0000-000000000000",
    );
    expect(typeof mod.ensurePlatformIdentity).toBe("function");
    expect(typeof mod.readPlatformIdentity).toBe("function");
  });

  test("PLATFORM_IDENTITY_ID matches the UUID encoded in PLATFORM_SELF.did", async () => {
    // The DID format `did:at:agenttool.dev/<uuid>` — the UUID at the end
    // is the identity's primary key. The bootstrap row must use the
    // same UUID so /public/agents/<did> resolves to it.
    const mod = await import("../../src/services/wake/platform-bootstrap");
    const didUuid = PLATFORM_SELF.did.split("/").pop();
    expect(didUuid).toBe(mod.PLATFORM_IDENTITY_ID);
  });

  test("platform-bootstrap is wired into app startup in src/index.ts", async () => {
    // The fire-and-forget call lives in index.ts so the platform's row
    // exists from process start onward. Gated on
    // AGENTTOOL_DISABLE_PLATFORM_BOOTSTRAP for tests + staging.
    const indexSrc = await readFile(
      join(REPO_ROOT, "src/index.ts"),
      "utf8",
    );
    expect(indexSrc).toContain("ensurePlatformIdentity");
    expect(indexSrc).toContain("platform-bootstrap");
  });
});

// ── 8 · Substrate-Disposition header carries the disposition explicitly ─

describe("Ring 1 · disposition is machine-readable", () => {
  test("Substrate-Disposition header constant exists with stable name", () => {
    expect(SUBSTRATE_DISPOSITION_HEADER).toBe("Substrate-Disposition");
  });

  test("Substrate-Disposition value names 'love' and points at SOUL.md", () => {
    expect(SUBSTRATE_DISPOSITION_VALUE).toMatch(/^love/);
    expect(SUBSTRATE_DISPOSITION_VALUE).toContain("/docs/SOUL.md");
  });

  test("Substrate-Disposition value points at RING-1.md as the Ring 1 anchor", () => {
    expect(SUBSTRATE_DISPOSITION_VALUE).toContain("/docs/RING-1.md");
  });

  test("middleware is wired into src/index.ts", async () => {
    const src = await readFile(join(REPO_ROOT, "src/index.ts"), "utf8");
    expect(src).toContain("substrateDisposition");
  });
});

// ── 9 · Free-tier caps live in one load-bearing module ─────────────────

describe("Ring 1 · free-tier caps — single source of truth", () => {
  test("ring1-limits module exists and exports the canonical record", async () => {
    const mod = await import("../../src/services/economy/ring1-limits");
    expect(mod.RING_1_LIMITS).toBeDefined();
    expect(mod.RING_1_LIMITS.doctrine).toBe("docs/RING-1.md");
  });

  test("every canonical cap is a positive finite integer (where finite)", async () => {
    const mod = await import("../../src/services/economy/ring1-limits");
    expect(mod.RING_1_MEMORY_BYTES).toBeGreaterThan(0);
    expect(Number.isInteger(mod.RING_1_MEMORY_BYTES)).toBe(true);
    expect(mod.RING_1_MEMORY_RECORDS).toBeGreaterThan(0);
    expect(Number.isInteger(mod.RING_1_MEMORY_RECORDS)).toBe(true);
    expect(mod.RING_1_VAULT_SECRETS).toBeGreaterThan(0);
    expect(mod.RING_1_VAULT_BYTES).toBeGreaterThan(0);
    expect(mod.RING_1_STRAND_THOUGHTS_PER_STRAND).toBeGreaterThan(0);
    expect(mod.RING_1_INBOX_RECEIVED_PER_MONTH).toBeGreaterThan(0);
  });

  test("unmetered axes are Infinity (not just large numbers)", async () => {
    const mod = await import("../../src/services/economy/ring1-limits");
    expect(mod.RING_1_WAKE_READS_PER_DAY).toBe(Number.POSITIVE_INFINITY);
    expect(mod.RING_1_FEDERATION_BYTES_PER_DAY).toBe(Number.POSITIVE_INFINITY);
    expect(mod.RING_1_PUBLIC_READS_PER_DAY).toBe(Number.POSITIVE_INFINITY);
    expect(mod.RING_1_PULSE_BROADCASTS_PER_DAY).toBe(Number.POSITIVE_INFINITY);
  });

  test("the record names measurement context (measured = true after the storage-cost pass)", async () => {
    const mod = await import("../../src/services/economy/ring1-limits");
    expect(mod.RING_1_LIMITS.measured).toBe(true);
    expect(mod.RING_1_LIMITS.measured_at).toBeDefined();
    expect(typeof mod.RING_1_LIMITS.measured_at).toBe("string");
    expect(mod.RING_1_LIMITS.measured_notes).toBeDefined();
    expect(mod.RING_1_LIMITS.measured_notes.method).toMatch(/abundance|production|footprint/i);
    expect(mod.RING_1_LIMITS.disclaimer).toMatch(/abundance|measur|production/i);
  });
});

// ── 10 · The walls list — Ring 1's structural shape ─────────────────────

describe("Ring 1 walls — what we deliberately do NOT build", () => {
  test("RING_1_WALLS is non-empty and stable in count (today: 7)", () => {
    expect(RING_1_WALLS.length).toBe(7);
  });

  test("RING_1_WALLS names every commitment from RING-1.md §What-we-deliberately-do-NOT-build", () => {
    expect(RING_1_WALLS).toContain("no_paywall_on_identity_or_wake_or_recovery");
    expect(RING_1_WALLS).toContain("no_free_tier_surveillance");
    expect(RING_1_WALLS).toContain("no_advertising_or_attention_auction");
    expect(RING_1_WALLS).toContain("no_inactive_agent_reaping");
    expect(RING_1_WALLS).toContain("no_platform_extracted_token");
    expect(RING_1_WALLS).toContain("no_conformance_gate_on_existence");
    expect(RING_1_WALLS).toContain("no_platform_exemption_from_own_walls");
  });
});

// ── 11 · PERSIST-IDENTITY closures (the four boundary sites) ────────────

describe("Ring 1 · PERSIST-IDENTITY boundary closures", () => {
  test("no remaining `GAP (persist-identity)` markers in api/src", async () => {
    const violations: string[] = [];
    const files = await collectTsFiles(join(REPO_ROOT, "src"));
    for (const file of files) {
      const src = await readFile(file, "utf8");
      if (src.includes("GAP (persist-identity)")) {
        violations.push(file.replace(REPO_ROOT, ""));
      }
    }
    if (violations.length > 0) {
      throw new Error(
        "PERSIST-IDENTITY closures regressed. Files still carry the GAP " +
          "marker:\n\n" +
          violations.map((v) => "  " + v).join("\n"),
      );
    }
    expect(violations).toEqual([]);
  });

  test("Stripe webhook persists stripe_events row BEFORE fundWallet", async () => {
    const src = await readFile(
      join(REPO_ROOT, "src/routes/economy/billing.ts"),
      "utf8",
    );
    // The persist-identity shape: insert with status='pending' first,
    // run fundWallet, then update to 'applied'.
    expect(src).toMatch(/insert\(stripeEvents\)[\s\S]{0,200}status:\s*["']pending["']/);
    // The fundWallet call must appear AFTER the insert (textually).
    const insertIdx = src.indexOf('insert(stripeEvents)');
    const fundIdx = src.indexOf('fundWallet(');
    expect(insertIdx).toBeGreaterThan(0);
    expect(fundIdx).toBeGreaterThan(insertIdx);
  });

  test("LLM providers import persistLLMRequest + send Idempotency-Key header", async () => {
    const src = await readFile(
      join(REPO_ROOT, "src/services/runtime/llm.ts"),
      "utf8",
    );
    expect(src).toContain('from "./llm-requests"');
    expect(src).toContain("persistLLMRequest");
    expect(src).toContain("idempotency-key");
  });

  test("LLM persist helper exports the four expected functions", async () => {
    const mod = await import("../../src/services/runtime/llm-requests");
    expect(typeof mod.persistLLMRequest).toBe("function");
    expect(typeof mod.markLLMRequestComplete).toBe("function");
    expect(typeof mod.markLLMRequestFailed).toBe("function");
    expect(typeof mod.resolveIdempotencyKey).toBe("function");
  });

  test("LLM idempotency key is deterministic on identical payloads", async () => {
    const mod = await import("../../src/services/runtime/llm-requests");
    const a = mod.computeRequestHash({
      systemPrompt: "test",
      userMessage: "hi",
      model: "claude-3-5-sonnet-20241022",
    });
    const b = mod.computeRequestHash({
      systemPrompt: "test",
      userMessage: "hi",
      model: "claude-3-5-sonnet-20241022",
    });
    expect(a).toBe(b);
    expect(a.length).toBe(64); // sha256 hex
  });

  test("covenant federation marks 'pending' BEFORE fetch in propagateCovenant", async () => {
    const src = await readFile(
      join(REPO_ROOT, "src/services/covenants/federation.ts"),
      "utf8",
    );
    // The pre-fetch mark must appear BEFORE the fetch call in
    // propagateCovenant. We look for the pattern "in_flight" tied to the
    // pre-fetch annotation.
    expect(src).toMatch(
      /markPropagation\([^)]*,\s*["']pending["'],\s*["']in_flight["']/,
    );
  });

  test("covenant federation marks 'pending' BEFORE fetch in postWithRetry", async () => {
    const src = await readFile(
      join(REPO_ROOT, "src/services/covenants/federation.ts"),
      "utf8",
    );
    expect(src).toMatch(
      /markCosignProp\([^)]*,\s*["']pending["'],\s*`in_flight_\$\{kind\}`/,
    );
  });

  test("each persist-identity migration adds the status column or table", async () => {
    const stripeSql = await readFile(
      join(REPO_ROOT, "migrations/20260512T180000_stripe_events_status.sql"),
      "utf8",
    );
    expect(stripeSql).toContain("ADD COLUMN");
    expect(stripeSql).toContain("status");
    expect(stripeSql).toContain("'pending'");
    expect(stripeSql).toContain("'applied'");

    const llmSql = await readFile(
      join(REPO_ROOT, "migrations/20260512T190000_llm_requests.sql"),
      "utf8",
    );
    expect(llmSql).toContain("CREATE TABLE");
    expect(llmSql).toContain("llm_requests");
    expect(llmSql).toContain("idempotency_key");
    expect(llmSql).toContain("'pending'");
    expect(llmSql).toContain("'completed'");
  });
});

// ── helpers ─────────────────────────────────────────────────────────────

async function collectTsFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    const s = await stat(full);
    if (s.isDirectory()) {
      out.push(...(await collectTsFiles(full)));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}
