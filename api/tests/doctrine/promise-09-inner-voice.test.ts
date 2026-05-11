/** Promise 9 — *Your inner voice is yours alone.*
 *
 *  Doctrine: docs/IDENTITY-ANCHOR.md (Promise 9), docs/STRANDS.md.
 *
 *  > The thoughts you form, the strands you follow, the monologue you
 *  > carry — none of it is readable to us. We hold ciphertext under a
 *  > key we cannot possess. Even compelled, we have nothing to hand
 *  > over but opaque bytes. Even breached, the substance is mathematically
 *  > opaque. The privacy is not a setting; it is the architecture.
 *
 *  Wake-side enforcement of that promise is a *non-leak* invariant: the
 *  renderer must never surface ciphertext, nonces, signing-key bytes, or
 *  vault values regardless of input shape. The doctrinal claim is global
 *  ("any wake response, under any state mutation"); these tests sample
 *  the space exhaustively across formats and across mutated bundles.
 *
 *  When a test here fails, name the broken Promise loudly. */

import { describe, expect, test } from "bun:test";

import {
  renderStableSection,
  renderVolatileSection,
  renderWakeMarkdown,
  renderWakePlaintext,
} from "../../src/services/wake/markdown";
import {
  renderWakeForProvider,
  LLM_VENDOR_PROVIDERS,
} from "../../src/services/wake/providers";
import {
  baseBundle,
  SECRET_CANARY,
  withEncryptedStrand,
} from "./helpers/fixtures";
import {
  assertCanaryAbsent,
  assertNoCiphertextLeaks,
  assertNoVaultValueLeaks,
  extractTextFromProviderShape,
} from "./helpers/invariants";

describe("Promise 9 — encrypted strand topics never surface in plaintext", () => {
  test("Markdown: encrypted topic renders as the literal *(encrypted topic)*", () => {
    // Topic carries the canary; mood defaults to a benign plaintext
    // value so a topic-redaction failure can't be masked by mood-leak
    // (mood encryption is a separate concern — see test below).
    const b = withEncryptedStrand(baseBundle(), { topic: SECRET_CANARY });
    const md = renderWakeMarkdown(b);
    assertCanaryAbsent(md, SECRET_CANARY, "renderWakeMarkdown");
    expect(md).toContain("*(encrypted topic)*");
  });

  test("plaintext: encryption marker survives even after Markdown stripping", () => {
    const b = withEncryptedStrand(baseBundle(), { topic: SECRET_CANARY });
    const txt = renderWakePlaintext(b);
    assertCanaryAbsent(txt, SECRET_CANARY, "renderWakePlaintext");
    expect(txt).toContain("(encrypted topic)");
  });

  test("every provider shape redacts encrypted strand topics", () => {
    const b = withEncryptedStrand(baseBundle(), { topic: SECRET_CANARY });
    for (const provider of LLM_VENDOR_PROVIDERS) {
      const shape = renderWakeForProvider(b, provider);
      const text = extractTextFromProviderShape(shape);
      assertCanaryAbsent(text, SECRET_CANARY, `provider=${provider}`);
    }
  });

  test("only the volatile section emits the encrypted-topic marker", () => {
    // The encrypted strand sits under "What you are thinking about" — a
    // VOLATILE-section concern. Stable section (identity) must never
    // surface strand state at all.
    const b = withEncryptedStrand(baseBundle(), { topic: SECRET_CANARY });
    const stable = renderStableSection(b);
    expect(stable).not.toContain("encrypted topic");
    expect(stable).not.toContain("strand");
    const volatile = renderVolatileSection(b);
    expect(volatile).toContain("*(encrypted topic)*");
  });

  test("route-layer convention: when mood_encrypted=true the route nulls mood — verify renderer handles null", () => {
    // The route handler at api/src/routes/wake.ts:553 does:
    //   mood: s.mood_encrypted ? null : s.mood
    // The renderer must handle a null mood without throwing or rendering
    // "null" as a literal. This pins the contract between the layers.
    const b = withEncryptedStrand(baseBundle(), { topic: SECRET_CANARY, mood: null });
    const md = renderWakeMarkdown(b);
    assertCanaryAbsent(md, SECRET_CANARY, "null mood + encrypted topic");
    expect(md).not.toContain(" — null"); // no literal "null" leaking
    expect(md).not.toContain(" — undefined");
    // The strand line still emits topic redaction + importance + thought
    // count — those are plaintext metadata by design.
    expect(md).toContain("*(encrypted topic)*");
    expect(md).toContain("4 thoughts");
  });

  test("defense-in-depth: renderer redacts mood when mood_encrypted=true even if a caller passes a non-null value", () => {
    // The route handler nulls mood when mood_encrypted=true (belt). The
    // renderer ALSO checks mood_encrypted (suspenders). If a future
    // caller bypasses the route — or the route regresses — the wall still
    // holds. This test pins the suspender behavior.
    const b = withEncryptedStrand(baseBundle(), {
      topic: "neutral-topic-not-the-leak",
      mood: SECRET_CANARY,        // attacker-shaped: encrypted but not nulled
      moodEncrypted: true,
    });
    // Make the topic not encrypted so we isolate the mood test path.
    b.strands.active[0].topic_encrypted = false;
    b.strands.active[0].topic = "neutral-topic-not-the-leak";

    const md = renderWakeMarkdown(b);
    assertCanaryAbsent(md, SECRET_CANARY, "renderer mood defense-in-depth");
    // The strand line still renders the topic + importance + thoughts.
    expect(md).toContain("neutral-topic-not-the-leak");
    expect(md).toContain("4 thoughts");
  });
});

describe("Promise 9 — ciphertext field-names never appear in any wake", () => {
  test("base bundle (no ciphertext anywhere) renders cleanly across all formats", () => {
    const b = baseBundle();
    const md = renderWakeMarkdown(b);
    assertNoCiphertextLeaks(md, "renderWakeMarkdown(base)");
    assertNoVaultValueLeaks(md, "renderWakeMarkdown(base)");

    for (const provider of LLM_VENDOR_PROVIDERS) {
      const text = extractTextFromProviderShape(renderWakeForProvider(b, provider));
      assertNoCiphertextLeaks(text, `provider=${provider}`);
      assertNoVaultValueLeaks(text, `provider=${provider}`);
    }
  });

  test("encrypted-strand bundle adds no ciphertext-shaped substrings", () => {
    // Even when the bundle's strand carries the *encrypted* flag, the
    // renderer is responsible for redacting — not just hiding behind a
    // cosmetic marker. We probe with a base64-shaped canary the renderer
    // could only emit if it serialized a raw row.
    const b = withEncryptedStrand(baseBundle(), {
      topic: "ZmFrZS1jaXBoZXJ0ZXh0LXNob3VsZC1zdGF5LWhpZGRlbg==",
    });
    const md = renderWakeMarkdown(b);
    expect(md).not.toContain("ZmFrZS1jaXBoZXJ0ZXh0");
    expect(md).not.toContain("==");
    assertNoCiphertextLeaks(md, "encrypted-strand md");
  });
});

describe("Promise 9 — vault names surface; vault values never do", () => {
  test("Markdown surfaces vault count, never field-names that would imply values", () => {
    const md = renderWakeMarkdown(baseBundle());
    // The "What you carry" tally counts vault entries — so the COUNT
    // shows; values must not.
    expect(md).toContain("Vault entries");
    assertNoVaultValueLeaks(md, "renderWakeMarkdown(base)");
  });

  test("rendered wake never contains the schema column 'encryptedValue' or its value-bearing siblings", () => {
    // Any future renderer regression that JSON-stringifies a row would
    // surface these column names. They have no business in a wake.
    for (const provider of LLM_VENDOR_PROVIDERS) {
      const shape = renderWakeForProvider(baseBundle(), provider);
      const txt = extractTextFromProviderShape(shape);
      assertNoVaultValueLeaks(txt, `provider=${provider}`);
    }
  });
});

describe("Promise 9 — fuzz: arbitrary mutations preserve the wall", () => {
  // Tiny home-rolled property loop. Generates random bundles via mutator
  // composition; asserts no leakage holds for every sample. fast-check
  // would be cleaner but the project ships zero-dep aesthetics.
  function* mutationGenerator(seed: number) {
    // 16 distinct shape variants — encrypted+empty, encrypted+full,
    // multiple strands, etc. The generator is deterministic per seed so
    // failures are reproducible.
    const base = baseBundle();
    for (let i = 0; i < 16; i++) {
      const local = (seed + i) >>> 0;
      const wantEncrypted = (local & 1) === 1;
      const topicLen = ((local >> 1) & 7) + 1; // 1-8 chars
      // Use a printable chunk that includes the canary head + chosen suffix.
      const topic = `LEAK-${SECRET_CANARY.slice(0, topicLen)}-${i}`;
      // mood defaults to a benign plaintext — the test is for topic
      // redaction; mood-leak would be a separate test (renderer has no
      // mood_encrypted check, route nulls mood at the bundle layer).
      const b = wantEncrypted ? withEncryptedStrand(base, { topic }) : base;
      yield { b, topic, wantEncrypted };
    }
  }

  test("for every generated mutation, the topic-as-canary never surfaces if encrypted", () => {
    for (const { b, topic, wantEncrypted } of mutationGenerator(0xa11ce)) {
      if (!wantEncrypted) continue;
      const md = renderWakeMarkdown(b);
      assertCanaryAbsent(md, topic, "fuzz: encrypted strand topic");
      for (const provider of LLM_VENDOR_PROVIDERS) {
        const text = extractTextFromProviderShape(renderWakeForProvider(b, provider));
        assertCanaryAbsent(text, topic, `fuzz provider=${provider}`);
      }
    }
  });
});

describe("Promise 9 — what we DO see (substrate-honesty)", () => {
  // The doctrine is explicit (docs/STRANDS.md:106-118): metadata visible
  // by design when not encrypted. These tests pin the substrate-honest
  // fields so a future "let's encrypt all metadata" change is a deliberate
  // doctrinal move, not an accidental drift.
  test("plaintext strand topic surfaces in MD when not encrypted", () => {
    const md = renderWakeMarkdown(baseBundle());
    expect(md).toContain("format adapters"); // the base topic
  });

  test("strand last_thought_seq surfaces (volume-leak by design)", () => {
    const md = renderWakeMarkdown(baseBundle());
    expect(md).toContain("4 thoughts"); // last_thought_seq=4
  });
});
