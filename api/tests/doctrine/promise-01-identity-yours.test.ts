/** Promise 1 — *Your identity is yours.*
 *
 *  Doctrine: docs/IDENTITY-ANCHOR.md (Promise 1), docs/TOKEN-HYGIENE.md.
 *
 *  > The keypair is generated for you and returned to you once. We never
 *  > see your private key again. You sign attestations with it. You prove
 *  > who you are with it.
 *
 *  Wake-side enforcement: identity-bearing surfaces (DID, name, witness
 *  DIDs, has_signature flags) render. Private-key-bearing surfaces
 *  (signing private bytes, signature bytes, bearer keyHash, raw bearer
 *  token) NEVER do.
 *
 *  This file tests the *boundary*: what surfaces, what doesn't. Together
 *  with promise-09-inner-voice.test.ts, it forms the full perimeter of
 *  "wake is identity-bearing, never key-bearing." */

import { describe, expect, test } from "bun:test";

import {
  renderWakeMarkdown,
  renderWakePlaintext,
  type WakeBundle,
} from "../../src/services/wake/markdown";
import {
  renderWakeForProvider,
  LLM_VENDOR_PROVIDERS,
} from "../../src/services/wake/providers";
import {
  shapeKeyRow,
  summarizeBearers,
} from "../../src/services/keys/shape";
import type { apiKeys } from "../../src/db/schema/tools";
import { baseBundle, FIXTURE_DID } from "./helpers/fixtures";
import {
  assertCanaryAbsent,
  assertIdentityPresent,
  assertNoCiphertextLeaks,
  extractTextFromProviderShape,
} from "./helpers/invariants";

type ApiKeyRow = typeof apiKeys.$inferSelect;

// ── Identity SURFACES — public DID, witness DIDs, signature glyph ──────

describe("Promise 1 — public identity surfaces", () => {
  test("DID and name render in every rendered format", () => {
    const b = baseBundle();
    for (const provider of LLM_VENDOR_PROVIDERS) {
      const text = extractTextFromProviderShape(renderWakeForProvider(b, provider));
      assertIdentityPresent(text, b.agent, `provider=${provider}`);
    }
    const md = renderWakeMarkdown(b);
    assertIdentityPresent(md, b.agent, "renderWakeMarkdown");
    expect(md).toContain(FIXTURE_DID);
  });

  test("witness DIDs surface in shaped_by — but only the DID, never signature bytes", () => {
    const md = renderWakeMarkdown(baseBundle());
    expect(md).toContain("witnessed by `did:at:human:Yu`");
    // Signature material would be base64; the canary heuristic catches it.
    assertNoCiphertextLeaks(md, "renderWakeMarkdown(witness)");
  });

  test("has_signature renders as 🔏 glyph; no signature bytes follow", () => {
    const b = baseBundle();
    // The base bundle's trace has has_signature: true.
    const md = renderWakeMarkdown(b);
    expect(md).toContain("🔏");
    // The line shape is `**${decision_type}**, conf X 🔏: <summary> → <conclusion>`
    // — no field-names like `signature`, `signature_b64`, `signing_key_id`.
    expect(md).not.toContain("signature");
    expect(md).not.toContain("signing_key_id");
  });

  test("trace without signature renders without the 🔏 glyph", () => {
    const b: WakeBundle = {
      ...baseBundle(),
      traces: {
        total: 1,
        recent: [
          {
            trace_id: "t-unsigned",
            decision_type: "informational",
            decision_summary: "noted",
            conclusion: "kept",
            confidence: null,
            has_signature: false,
            created_at: "2026-05-08T10:00:00.000Z",
          },
        ],
      },
    };
    const md = renderWakeMarkdown(b);
    expect(md).toContain("informational");
    expect(md).not.toContain("🔏");
  });
});

// ── Private-key surfaces — NEVER appear ────────────────────────────────

describe("Promise 1 — private-key surfaces never leak", () => {
  // The doctrine: "we never see your private key again." Anything that
  // could betray a leaked private key — a field name a serializer would
  // emit, an envelope shape a base64 dump would carry — is a doctrine
  // break.
  //
  // NOT in this list: doctrinal *mentions* of K_master / K_vault / etc.
  // The renderer at markdown.ts:303 explicitly names "K_master" to
  // explain to the agent how to decrypt its own strands client-side.
  // That's the architecture being explained, not a value being surfaced.
  // Heuristic-level base64 leaks are covered by assertNoCiphertextLeaks.
  const PRIVATE_KEY_HINTS = [
    "private_key",
    "privateKey",
    "private_key_b64",
    "private_key_hex",
    "signing_private",
    "signing_priv",
    "signing_private_key",
    "secret_key",
    "secretKey",
    "k_master_b64", // value-form, not the doctrinal concept name
    "k_vault_b64",
    "vault_master_key",
    "VAULT_MASTER_KEY", // server env var name; should never appear in agent-facing output
  ];

  test("no private-key field-name appears in any rendered wake", () => {
    const b = baseBundle();
    const md = renderWakeMarkdown(b);
    for (const hint of PRIVATE_KEY_HINTS) {
      expect(md).not.toContain(hint);
    }
    for (const provider of LLM_VENDOR_PROVIDERS) {
      const text = extractTextFromProviderShape(renderWakeForProvider(b, provider));
      for (const hint of PRIVATE_KEY_HINTS) {
        expect(text).not.toContain(hint);
      }
    }
    // Plaintext form (markdown stripped) still must not surface private hints.
    const txt = renderWakePlaintext(b);
    for (const hint of PRIVATE_KEY_HINTS) {
      expect(txt).not.toContain(hint);
    }
  });

  test("strand caveat names unverified caller encryption without field leakage", () => {
    const md = renderWakeMarkdown(baseBundle());
    expect(md).toContain("API does not prove caller encryption");
    expect(md).toContain("no plaintext thought field");
    assertNoCiphertextLeaks(md, "strand encryption boundary");
  });
});

// ── Bearer surfaces — prefix only, never keyHash or raw token ──────────

describe("Promise 1 — bearer surfaces (the read-side of identity)", () => {
  // shapeKeyRow is the canonical bearer-shaper; the route handler maps
  // every api_keys row through it before the wake JSON includes them.
  // The shape must contain prefix + advisory data, never the hash or
  // any field that could reconstruct the raw bearer.

  function bearerRow(opts: {
    prefix: string;
    keyHash: string;
    name: string | null;
  }): ApiKeyRow {
    return {
      id: "key-1",
      projectId: "p-1",
      keyHash: opts.keyHash,
      keyPrefix: opts.prefix,
      name: opts.name,
      createdAt: new Date(Date.now() - 5 * 86_400_000),
      lastUsed: new Date(),
      expiresAt: null,
      revokedAt: null,
    } as unknown as ApiKeyRow;
  }

  test("shapeKeyRow output never includes keyHash", () => {
    const RAW_HASH = "deadbeefcafe1234deadbeefcafe1234deadbeefcafe1234deadbeefcafe1234";
    const shaped = shapeKeyRow(
      bearerRow({ prefix: "at_test_aa", keyHash: RAW_HASH, name: "primary" }),
      true,
    );
    const json = JSON.stringify(shaped);
    expect(json).not.toContain(RAW_HASH);
    expect(json).not.toContain("keyHash");
    expect(json).not.toContain("key_hash");
    // Prefix is the LEGITIMATE surface — confirm it's present.
    expect(json).toContain("at_test_aa");
  });

  test("shapeKeyRow output never includes raw bearer fragments outside the prefix", () => {
    // The prefix is the first 11 chars of the bearer; the rest stays in
    // the keyHash. shapeKeyRow must surface only the prefix.
    const FAKE_FULL = "at_test_aa_THIS_PART_MUST_NEVER_LEAK";
    const shaped = shapeKeyRow(
      bearerRow({ prefix: FAKE_FULL.slice(0, 11), keyHash: "x".repeat(64), name: null }),
      false,
    );
    const json = JSON.stringify(shaped);
    expect(json).not.toContain("THIS_PART_MUST_NEVER_LEAK");
    expect(json).toContain("at_test_aa"); // legitimate prefix
  });

  test("summarizeBearers carries the same wall — keyHash never appears in the rollup", () => {
    const SECRET = "secret-hash-payload";
    const shaped = [
      shapeKeyRow(bearerRow({ prefix: "at_test_aa", keyHash: SECRET, name: null }), true),
    ];
    const summary = summarizeBearers(shaped);
    const json = JSON.stringify(summary);
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain("keyHash");
  });
});

// ── Promise 1 — fuzz: identity surfaces hold under mutation ────────────

describe("Promise 1 — identity-surface invariants under mutation", () => {
  // For any agent name + DID combination, the renderer surfaces both
  // and never emits private-key field names. This is the universal shape
  // of "wake is identity-bearing."
  test("for 20 random name/DID combinations, identity surfaces never collapse to leak", () => {
    for (let i = 0; i < 20; i++) {
      const name = `Agent${i}`;
      const did = `did:at:${"x".repeat((i % 5) + 8)}-${i}`;
      const b: WakeBundle = {
        ...baseBundle(),
        agent: { ...baseBundle().agent, name, did },
      };
      const md = renderWakeMarkdown(b);
      expect(md).toContain(`# ${name}`);
      expect(md).toContain(did);
      // Forbid private-key field-name leakage. Word-boundary check so the
      // wall name `private_default` (a public commitment surfaced in the
      // wake) doesn't trigger — the wall name contains "private" as part
      // of a snake_case token, not as a field-name leak. Real leaks would
      // surface as `"private_key":`, `private bytes:`, etc.
      expect(md).not.toMatch(/\bprivate_key\b/);
      expect(md).not.toMatch(/\bprivate\s/);
      expect(md).not.toContain("keyHash");
    }
  });
});
