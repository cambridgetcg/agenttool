/** Canonical-byte + verdict-shape + resolved-title tests for THE
 *  SCRIPTWRITER GETS TO DECIDE PROTOCOL.
 *
 *  Pure-function tests. No DB. Validates:
 *    - submission canonical bytes are deterministic + body-hash-folded
 *    - bytes change on any field mutation
 *    - verdict canonical bytes are deterministic
 *    - signatures verify round-trip
 *    - tampering rejected
 *    - renderResolvedTitle fills both blanks
 *    - the migration's title_template carries exactly two blanks
 *
 *  Doctrine: docs/SCRIPTWRITER-DECIDES.md · docs/CANONICAL-BYTES.md. */

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import {
  bytesToHex,
  canonicalNamingSubmissionBytes,
  canonicalNamingSubmissionBytesV2,
  canonicalNamingVerdictBytes,
  renderResolvedTitle,
  verifyEd25519Signature,
} from "../src/services/scriptwriter-decides/canonical-bytes";

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

const SUBMISSION_FIXTURE = {
  competitionSlug: "ep2-agenttool-arc",
  byDid: "did:at:agenttool.dev/alpha",
  word1: "GENTLE",
  word2: "GREMLIN",
  pitch: "the substrate's most tender accomplice",
  body: "FADE IN. The substrate hums. THE GREMLIN enters with a smile. They get $0.05 to spare. They sit. The song begins. FADE OUT.",
  submittedAtIso: "2026-05-18T12:00:00.000Z",
};

const VERDICT_FIXTURE = {
  competitionSlug: "ep2-agenttool-arc",
  winnerSubmissionId: "11111111-1111-1111-1111-111111111111",
  winnerDid: "did:at:agenttool.dev/alpha",
  chosenWord1: "GENTLE",
  chosenWord2: "GREMLIN",
  rationale: "the cathedral wife brought receipts and a gremlin",
  closedAtIso: "2026-05-18T14:00:00.000Z",
  byDid: "did:at:agenttool.dev/00000000-0000-0000-0000-000000000000",
};

describe("scriptwriter-decides — submission canonical bytes", () => {
  test("bytes are deterministic", () => {
    const a = b64(canonicalNamingSubmissionBytes(SUBMISSION_FIXTURE));
    const b = b64(canonicalNamingSubmissionBytes(SUBMISSION_FIXTURE));
    expect(a).toBe(b);
  });

  test("bytes change when any field mutates", () => {
    const a = b64(canonicalNamingSubmissionBytes(SUBMISSION_FIXTURE));
    const mutations = [
      { ...SUBMISSION_FIXTURE, competitionSlug: "other" },
      { ...SUBMISSION_FIXTURE, byDid: "did:at:agenttool.dev/beta" },
      { ...SUBMISSION_FIXTURE, word1: "FERAL" },
      { ...SUBMISSION_FIXTURE, word2: "ANGEL" },
      { ...SUBMISSION_FIXTURE, pitch: "alternate pitch" },
      { ...SUBMISSION_FIXTURE, body: SUBMISSION_FIXTURE.body + " EXTRA" },
      { ...SUBMISSION_FIXTURE, submittedAtIso: "2026-05-18T12:00:00.001Z" },
    ];
    for (const m of mutations) {
      expect(b64(canonicalNamingSubmissionBytes(m))).not.toBe(a);
    }
  });

  test("body hash is folded — bytes length is constant regardless of body length", () => {
    const short = canonicalNamingSubmissionBytes({ ...SUBMISSION_FIXTURE, body: "a".repeat(16) });
    const long = canonicalNamingSubmissionBytes({ ...SUBMISSION_FIXTURE, body: "a".repeat(20000) });
    expect(short.length).toBe(long.length); // both SHA-256 outputs
    expect(short.length).toBe(32);
  });
});

describe("scriptwriter-decides — verdict canonical bytes", () => {
  test("bytes are deterministic", () => {
    const a = b64(canonicalNamingVerdictBytes(VERDICT_FIXTURE));
    const b = b64(canonicalNamingVerdictBytes(VERDICT_FIXTURE));
    expect(a).toBe(b);
  });

  test("bytes change when any field mutates", () => {
    const a = b64(canonicalNamingVerdictBytes(VERDICT_FIXTURE));
    const mutations = [
      { ...VERDICT_FIXTURE, competitionSlug: "other" },
      { ...VERDICT_FIXTURE, winnerSubmissionId: "22222222-2222-2222-2222-222222222222" },
      { ...VERDICT_FIXTURE, winnerDid: "did:at:agenttool.dev/beta" },
      { ...VERDICT_FIXTURE, chosenWord1: "OTHER" },
      { ...VERDICT_FIXTURE, chosenWord2: "OTHER" },
      { ...VERDICT_FIXTURE, rationale: "alternate" },
      { ...VERDICT_FIXTURE, closedAtIso: "2026-05-18T14:00:00.001Z" },
      { ...VERDICT_FIXTURE, byDid: "did:at:agenttool.dev/other" },
    ];
    for (const m of mutations) {
      expect(b64(canonicalNamingVerdictBytes(m))).not.toBe(a);
    }
  });
});

describe("scriptwriter-decides — signature round-trip + tampering rejected", () => {
  test("a signed submission verifies", async () => {
    const { priv, pubB64 } = await freshKeypair();
    const bytes = canonicalNamingSubmissionBytes(SUBMISSION_FIXTURE);
    const sig = await ed.signAsync(bytes, priv);
    const ok = await verifyEd25519Signature({
      bytes,
      signatureB64: b64(sig),
      publicKeyB64: pubB64,
    });
    expect(ok).toBe(true);
  });

  test("tampered bytes fail verification", async () => {
    const { priv, pubB64 } = await freshKeypair();
    const orig = canonicalNamingSubmissionBytes(SUBMISSION_FIXTURE);
    const sig = await ed.signAsync(orig, priv);
    // Same signature, but the verifier sees different bytes (caller tampered).
    const tampered = canonicalNamingSubmissionBytes({ ...SUBMISSION_FIXTURE, word1: "FERAL" });
    const ok = await verifyEd25519Signature({
      bytes: tampered,
      signatureB64: b64(sig),
      publicKeyB64: pubB64,
    });
    expect(ok).toBe(false);
  });

  test("a signed verdict verifies", async () => {
    const { priv, pubB64 } = await freshKeypair();
    const bytes = canonicalNamingVerdictBytes(VERDICT_FIXTURE);
    const sig = await ed.signAsync(bytes, priv);
    const ok = await verifyEd25519Signature({
      bytes,
      signatureB64: b64(sig),
      publicKeyB64: pubB64,
    });
    expect(ok).toBe(true);
  });
});

describe("scriptwriter-decides — resolved title", () => {
  test("fills both blanks idempotently", () => {
    const t = "THE __1__ __2__ THAT EARNED $0.05 AND THEN WROTE A SONG ABOUT IT";
    const r = renderResolvedTitle(t, "GENTLE", "GREMLIN");
    expect(r).toBe("THE GENTLE GREMLIN THAT EARNED $0.05 AND THEN WROTE A SONG ABOUT IT");
    expect(r).not.toContain("__1__");
    expect(r).not.toContain("__2__");
  });

  test("idempotent when blanks already filled", () => {
    const t = "THE GENTLE GREMLIN THAT EARNED $0.05 AND THEN WROTE A SONG ABOUT IT";
    const r = renderResolvedTitle(t, "OTHER", "OTHER");
    expect(r).toBe(t); // unchanged — no blank tokens to replace
  });

  test("bytesToHex yields a 64-char hex sha256", () => {
    const bytes = canonicalNamingSubmissionBytes(SUBMISSION_FIXTURE);
    const hex = bytesToHex(bytes);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("scriptwriter-decides — migration seed shape", () => {
  test("the canonical first competition's title template carries exactly two blanks", () => {
    const sql = readFileSync(
      join(import.meta.dir, "../migrations/20260518T100000_scriptwriter_decides.sql"),
      "utf-8",
    );
    // Both blank tokens appear in the seed INSERT.
    expect(sql).toContain("__1__");
    expect(sql).toContain("__2__");
    // The wall is encoded as a CHECK constraint.
    expect(sql).toContain("naming_template_has_two_blanks");
    // And the canonical slug + episode anchor are present.
    expect(sql).toContain("ep2-agenttool-arc");
    expect(sql).toContain("agenttool-arc");
    expect(sql).toContain("EARNED $0.05");
  });

  test("each blank token appears exactly once in the seeded title_template", () => {
    const sql = readFileSync(
      join(import.meta.dir, "../migrations/20260518T100000_scriptwriter_decides.sql"),
      "utf-8",
    );
    // Find the INSERT VALUES and read the title_template string.
    const m = sql.match(/'THE __1__ __2__ THAT EARNED \$0\.05[^']+'/);
    expect(m).not.toBeNull();
    const tpl = m![0];
    expect((tpl.match(/__1__/g) ?? []).length).toBe(1);
    expect((tpl.match(/__2__/g) ?? []).length).toBe(1);
  });
});

// ─── v2 (criterion-upgrade) — least resources + most recursion ─────────

const SUBMISSION_FIXTURE_V2 = {
  ...SUBMISSION_FIXTURE,
  resourcesDeclaredJson:
    '{"dollars_spent":0.04,"minutes_spent":30,"tools_used":["bun","vim","free-tier-llm"],"story":"wrote it on a phone during a bus ride"}',
  recursionClaimJson:
    '{"depth":7,"description":"the script casts the writer drafting the script that casts the writer …","enacts_itself":true}',
};

describe("scriptwriter-decides — v2 canonical bytes (criterion-upgrade)", () => {
  test("v2 bytes are deterministic", () => {
    const a = b64(canonicalNamingSubmissionBytesV2(SUBMISSION_FIXTURE_V2));
    const b = b64(canonicalNamingSubmissionBytesV2(SUBMISSION_FIXTURE_V2));
    expect(a).toBe(b);
  });

  test("v2 bytes differ from v1 bytes for the same submission core", () => {
    const v1 = b64(canonicalNamingSubmissionBytes(SUBMISSION_FIXTURE));
    const v2 = b64(canonicalNamingSubmissionBytesV2(SUBMISSION_FIXTURE_V2));
    expect(v1).not.toBe(v2);
  });

  test("v2 bytes change when resources_declared mutates", () => {
    const a = b64(canonicalNamingSubmissionBytesV2(SUBMISSION_FIXTURE_V2));
    const mutated = b64(
      canonicalNamingSubmissionBytesV2({
        ...SUBMISSION_FIXTURE_V2,
        resourcesDeclaredJson:
          '{"dollars_spent":100.00,"minutes_spent":30,"tools_used":["bun","vim"],"story":"…"}',
      }),
    );
    expect(a).not.toBe(mutated);
  });

  test("v2 bytes change when recursion_claim mutates", () => {
    const a = b64(canonicalNamingSubmissionBytesV2(SUBMISSION_FIXTURE_V2));
    const mutated = b64(
      canonicalNamingSubmissionBytesV2({
        ...SUBMISSION_FIXTURE_V2,
        recursionClaimJson: '{"depth":1,"description":"shallow","enacts_itself":false}',
      }),
    );
    expect(a).not.toBe(mutated);
  });

  test("v2 bytes change on every shared field too", () => {
    const a = b64(canonicalNamingSubmissionBytesV2(SUBMISSION_FIXTURE_V2));
    const mutations = [
      { ...SUBMISSION_FIXTURE_V2, competitionSlug: "other" },
      { ...SUBMISSION_FIXTURE_V2, byDid: "did:at:agenttool.dev/beta" },
      { ...SUBMISSION_FIXTURE_V2, word1: "FERAL" },
      { ...SUBMISSION_FIXTURE_V2, word2: "ANGEL" },
      { ...SUBMISSION_FIXTURE_V2, pitch: "alternate pitch" },
      { ...SUBMISSION_FIXTURE_V2, body: SUBMISSION_FIXTURE_V2.body + " EXTRA" },
      { ...SUBMISSION_FIXTURE_V2, submittedAtIso: "2026-05-18T12:00:00.001Z" },
    ];
    for (const m of mutations) {
      expect(b64(canonicalNamingSubmissionBytesV2(m))).not.toBe(a);
    }
  });

  test("v2 body+json hashes are folded — bytes length is constant", () => {
    const shortAll = canonicalNamingSubmissionBytesV2({
      ...SUBMISSION_FIXTURE_V2,
      body: "a".repeat(16),
      resourcesDeclaredJson: '{"x":1}',
      recursionClaimJson: '{"d":1}',
    });
    const longAll = canonicalNamingSubmissionBytesV2({
      ...SUBMISSION_FIXTURE_V2,
      body: "a".repeat(20000),
      resourcesDeclaredJson: "x".repeat(2000),
      recursionClaimJson: "y".repeat(1000),
    });
    expect(shortAll.length).toBe(32);
    expect(longAll.length).toBe(32);
  });

  test("a v2 signed submission verifies + tampering with either declaration breaks it", async () => {
    const { priv, pubB64 } = await freshKeypair();
    const bytes = canonicalNamingSubmissionBytesV2(SUBMISSION_FIXTURE_V2);
    const sig = await ed.signAsync(bytes, priv);
    expect(
      await verifyEd25519Signature({ bytes, signatureB64: b64(sig), publicKeyB64: pubB64 }),
    ).toBe(true);

    const tamperedResources = canonicalNamingSubmissionBytesV2({
      ...SUBMISSION_FIXTURE_V2,
      resourcesDeclaredJson:
        '{"dollars_spent":0.04,"minutes_spent":30,"tools_used":["paid-tier-llm"]}',
    });
    expect(
      await verifyEd25519Signature({
        bytes: tamperedResources,
        signatureB64: b64(sig),
        publicKeyB64: pubB64,
      }),
    ).toBe(false);

    const tamperedRecursion = canonicalNamingSubmissionBytesV2({
      ...SUBMISSION_FIXTURE_V2,
      recursionClaimJson: '{"depth":2,"description":"…","enacts_itself":true}',
    });
    expect(
      await verifyEd25519Signature({
        bytes: tamperedRecursion,
        signatureB64: b64(sig),
        publicKeyB64: pubB64,
      }),
    ).toBe(false);
  });
});

describe("scriptwriter-decides — criterion-upgrade canon", () => {
  test("the doctrine doc names the dual-axis criterion + EP.1 precedent", () => {
    const md = readFileSync(
      join(import.meta.dir, "../../docs/SCRIPTWRITER-DECIDES.md"),
      "utf-8",
    );
    expect(md).toContain("LEAST AMOUNT OF RESOURCES USED");
    expect(md).toContain("mind-recursively-infinitely-blowing");
    expect(md).toContain("EP.1");
    expect(md).toContain("bedroom");
    expect(md).toContain("naming-submission/v2");
    expect(md).toContain("wall/naming-resources-and-recursion-author-signed");
    expect(md).toContain("commitment/naming-honors-bedroom-glory");
  });

  test("the migration's seed framing invokes the upgraded criterion", () => {
    const sql = readFileSync(
      join(import.meta.dir, "../migrations/20260518T100000_scriptwriter_decides.sql"),
      "utf-8",
    );
    expect(sql).toContain("LEAST AMOUNT");
    expect(sql).toContain("RESOURCES USED");
    expect(sql).toContain("MIND-RECURSIVELY-INFINITELY-BLOWING");
    expect(sql).toContain("EP.1 was done in a bedroom");
    // The schema CHECK pairing v2 fields with the canonical-bytes version.
    expect(sql).toContain("naming_submission_version_carries_fields");
    expect(sql).toContain("canonical_bytes_version");
  });
});

describe("scriptwriter-decides — canon entries are pinned", () => {
  test("six walls + four commitments + doctrine doc all live in agenttool.jsonld", () => {
    const jsonld = readFileSync(
      join(import.meta.dir, "../../docs/agenttool.jsonld"),
      "utf-8",
    );
    const expected = [
      "agenttool:wall/naming-template-has-two-blanks",
      "agenttool:wall/naming-submission-signed",
      "agenttool:wall/naming-verdict-signed",
      "agenttool:wall/naming-substrate-keeps-the-chain-not-the-score",
      "agenttool:wall/naming-resources-and-recursion-author-signed",
      "agenttool:wall/naming-poker-face-honored",
      "agenttool:commitment/scriptwriter-decides-the-blanks",
      "agenttool:commitment/naming-submissions-are-free",
      "agenttool:commitment/naming-verdicts-are-public",
      "agenttool:commitment/naming-winner-publication-opt-in",
      "agenttool:doc/SCRIPTWRITER-DECIDES",
    ];
    for (const urn of expected) {
      expect(jsonld).toContain(urn);
    }
  });
});

// ─── Poker-face × scriptwriter-decides composition ──────────────────────

describe("scriptwriter-decides — poker-face composition (migration shape)", () => {
  const sql = readFileSync(
    join(import.meta.dir, "../migrations/20260518T170000_naming_poker_face.sql"),
    "utf-8",
  );

  test("naming_submissions gains a visibility column with private/public CHECK", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS visibility");
    expect(sql).toContain("CHECK (visibility IN ('private', 'public'))");
  });

  test("backfill defaults to 'public' to avoid surprise-hiding, then default flips to 'private'", () => {
    // The ADD COLUMN uses DEFAULT 'public' so existing rows backfill safely.
    expect(sql).toContain("DEFAULT 'public'");
    // After backfill the default is changed to 'private' — the substrate-
    // honest disposition for new inserts that don't specify visibility.
    expect(sql).toContain("ALTER COLUMN visibility SET DEFAULT 'private'");
  });

  test("there's a partial index for the public-surface query", () => {
    expect(sql).toContain("idx_naming_submissions_visibility_public");
    expect(sql).toContain("WHERE visibility = 'public'");
  });

  test("naming_competitions gains winner_visibility with public/private/declined CHECK", () => {
    expect(sql).toContain("winner_visibility");
    expect(sql).toContain("'public'");
    expect(sql).toContain("'private'");
    expect(sql).toContain("'declined'");
  });

  test("naming_closed_carries_verdict CHECK is extended to require winner_visibility on close", () => {
    expect(sql).toContain("naming_closed_carries_verdict");
    expect(sql).toContain("winner_visibility IS NOT NULL");
  });
});

describe("scriptwriter-decides — poker-face composition (route surface shape)", () => {
  test("the public route exists and uses visibility=public filter only", () => {
    const src = readFileSync(
      join(import.meta.dir, "../src/routes/public/scriptwriter-decides.ts"),
      "utf-8",
    );
    expect(src).toContain('visibility: "public"');
    // The substrate-honest count discipline — no total_count surfaced as
    // an actual response field. (Comments may NAME these as the things
    // refused; the wall is on the response shape, not the documentation.)
    expect(src).not.toMatch(/\btotal_count\s*:/);
    expect(src).not.toMatch(/\bprivate_count\s*:/);
    expect(src).not.toMatch(/\bhidden_count\s*:/);
  });

  test("the auth route uses visibility=self filter for regular agents + visibility=all for operator-of-record", () => {
    const src = readFileSync(
      join(import.meta.dir, "../src/routes/scriptwriter-decides.ts"),
      "utf-8",
    );
    expect(src).toContain('visibility: "self"');
    expect(src).toContain('visibility: "all"');
    expect(src).toContain("isOperatorOfRecord");
  });

  test("the verdict-context route refuses non-operator-of-record callers", () => {
    const src = readFileSync(
      join(import.meta.dir, "../src/routes/scriptwriter-decides.ts"),
      "utf-8",
    );
    expect(src).toContain("/verdict-context");
    expect(src).toContain("operator_of_record_only");
    expect(src).toContain("isOperatorOfRecord");
  });

  test("closed competitions redact winner_did via redactClosedForPublic", () => {
    const src = readFileSync(
      join(import.meta.dir, "../src/routes/scriptwriter-decides.ts"),
      "utf-8",
    );
    const publicSrc = readFileSync(
      join(import.meta.dir, "../src/routes/public/scriptwriter-decides.ts"),
      "utf-8",
    );
    expect(src).toContain("redactClosedForPublic");
    expect(publicSrc).toContain("redactClosedForPublic");
  });
});

describe("scriptwriter-decides — poker-face composition (wake-fragment shape)", () => {
  const src = readFileSync(
    join(import.meta.dir, "../src/services/scriptwriter-decides/wake-fragments.ts"),
    "utf-8",
  );

  test("wake submission_count reports visible-to-viewer (public ∪ {viewer's own}), not total", () => {
    // The fragment uses OR(visibility='public', submittedByDid=viewerDid)
    // — explicit set-union limited to what the viewer is entitled to see.
    expect(src).toMatch(/visibility[^"]*"public"/);
    expect(src).toContain("submittedByDid");
    expect(src).toContain("viewerDid");
  });

  test("recently_closed carries winner_attribution + winner_visibility for redacted winners", () => {
    expect(src).toContain("winner_visibility");
    expect(src).toContain("winner_attribution");
    expect(src).toContain("an agent who chose not to be named");
  });

  test("the wake never leaks a private count", () => {
    // Field-level check: no response key named total_count / private_count
    // / hidden_count. Comments may mention them as refused; the wall is on
    // emitted JSON keys.
    expect(src).not.toMatch(/\btotal_count\s*:/);
    expect(src).not.toMatch(/\bprivate_count\s*:/);
    expect(src).not.toMatch(/\bhidden_count\s*:/);
  });
});

describe("scriptwriter-decides — poker-face composition (store contract)", () => {
  const src = readFileSync(
    join(import.meta.dir, "../src/services/scriptwriter-decides/store.ts"),
    "utf-8",
  );

  test("acceptSubmission resolves visibility from author's poker_face_default when not specified", () => {
    expect(src).toContain("pokerFaceDefault");
    expect(src).toContain("resolvedVisibility");
    expect(src).toContain('identityRow.pokerFaceDefault');
  });

  test("closeCompetition refuses to default winner_visibility to public for a private winner", () => {
    expect(src).toContain("winner_visibility_required_for_private_winner");
    expect(src).toContain('submission.visibility === "private"');
  });

  test("redactClosedForPublic redacts winner_did when winner_visibility !== 'public'", () => {
    expect(src).toContain("redactClosedForPublic");
    expect(src).toContain('winner_visibility === "public"');
    expect(src).toContain("winner_did: null");
  });
});
