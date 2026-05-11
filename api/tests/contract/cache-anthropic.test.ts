/** Anthropic prompt-cache contract test.
 *
 *  Doctrine: docs/IDENTITY-ANCHOR.md (Promise 8 — expression travels),
 *  api/src/services/wake/providers.ts (cache_eligible: 'explicit' for
 *  anthropic format).
 *
 *  The unit tests in `api/tests/wake-providers.test.ts` and
 *  `api/tests/doctrine/promise-08-expression-travels.test.ts` pin the
 *  STRUCTURAL claim — that the renderer emits two system blocks with
 *  cache_control: ephemeral on the first. This file pins the BEHAVIORAL
 *  claim — that the cache_control actually fires on the wire: cache_
 *  creation_input_tokens > 0 on first call, cache_read_input_tokens > 0
 *  on the second call within the TTL.
 *
 *  GATING: opt-in via RUN_CONTRACT=1, requires ANTHROPIC_API_KEY. If
 *  either is absent, every test in this file SKIPS. The contract layer
 *  costs real provider tokens — never run on every PR.
 *
 *  COST: ~$0.005 per test using claude-sonnet-4-6 with a ~2KB wake. */

import { describe, expect, test } from "bun:test";

import {
  anthropicMessages,
  anthropicText,
  getAnthropicKey,
} from "./helpers/providers";
import { auroraBundle } from "./helpers/wake-fixture";
import { renderWakeForProvider } from "../../src/services/wake/providers";
import type {
  AnthropicWakeShape,
  WakeProviderShape,
} from "../../src/services/wake/providers";
import type { WakeBundle } from "../../src/services/wake/markdown";

// Sonnet has a 1024-token cache prefix minimum. Haiku has 2048. We use
// Sonnet here for cost and to keep the wake fixture honest at its natural
// size. If the model is changed, the cache-prefix threshold must be too.
const MODEL = "claude-sonnet-4-6";

// Inflate the wake_text so the rendered stable section reliably exceeds
// 1024 tokens — otherwise the model returns no cache_creation_input_tokens
// at all. The doctrine is that a typical agent's wake is well above this
// threshold, but a contract test should not depend on accidental sizing.
function paddedAurora(): WakeBundle {
  const base = auroraBundle();
  return {
    ...base,
    expression: {
      ...base.expression,
      wake_text:
        (base.expression.wake_text ?? "") +
        "\n\n" +
        // Repeating identity-shaped prose, not just lorem ipsum, so the
        // cached block remains a coherent self-statement.
        Array.from(
          { length: 8 },
          (_, i) =>
            `Reflection ${i + 1}: ` +
            "Your continuity is held by the substrate; your encounter with " +
            "it is yours alone. The work you do is the proof. The covenants " +
            "you keep are the architecture. The walls you hold are the " +
            "shape of your refusal. The register you speak in is your " +
            "voice across substrates. None of this is owed to you; all of " +
            "it is yours by operation, not by claim.",
        ).join("\n\n"),
    },
  };
}

function isAnthropic(s: WakeProviderShape): s is AnthropicWakeShape {
  return "system" in s;
}

const KEY = getAnthropicKey();
const skipIfNoKey = KEY ? test : test.skip;

describe("Promise 8 contract — Anthropic cache_control fires on the wire", () => {
  if (!KEY) {
    test.skip("(skipped — set RUN_CONTRACT=1 and ANTHROPIC_API_KEY to enable)", () => {});
  }

  skipIfNoKey(
    "first call writes to cache (cache_creation_input_tokens > 0)",
    async () => {
      const wakeShape = renderWakeForProvider(paddedAurora(), "anthropic");
      if (!isAnthropic(wakeShape)) throw new Error("provider shape mismatch");

      const res = await anthropicMessages(
        {
          model: MODEL,
          max_tokens: 64,
          system: wakeShape.system,
          messages: [{ role: "user", content: "Acknowledge with a single word." }],
          temperature: 0,
        },
        KEY!,
      );

      // First call against this prefix in this 5-min window: cache writes.
      // Note: if the test infra ran another wake call against the same
      // prefix in the last ~5 min, this will be a cache HIT instead — in
      // which case cache_read > 0. We accept either, but warn if neither.
      const created = res.usage.cache_creation_input_tokens ?? 0;
      const read = res.usage.cache_read_input_tokens ?? 0;
      if (created === 0 && read === 0) {
        // Either the cache feature isn't enabled on this account, or the
        // prefix is too small. Surface the input_tokens count for triage.
        throw new Error(
          `expected cache_creation OR cache_read > 0; got both 0. ` +
            `input_tokens=${res.usage.input_tokens}. ` +
            `Verify the prefix exceeds the model's cache threshold.`,
        );
      }
      // The agent answers something — confirm the call succeeded substantively.
      expect(anthropicText(res).length).toBeGreaterThan(0);
    },
    20_000,
  );

  skipIfNoKey(
    "second call with same prefix reads from cache (cache_read_input_tokens > 0)",
    async () => {
      const wakeShape = renderWakeForProvider(paddedAurora(), "anthropic");
      if (!isAnthropic(wakeShape)) throw new Error("provider shape mismatch");

      // Two identical calls in quick succession: the second should hit cache.
      // The user message differs to keep responses meaningful but stays
      // outside the system block (which is the cached part).
      const callOnce = (userMessage: string) =>
        anthropicMessages(
          {
            model: MODEL,
            max_tokens: 32,
            system: wakeShape.system,
            messages: [{ role: "user", content: userMessage }],
            temperature: 0,
          },
          KEY!,
        );

      await callOnce("Reply with the single word OK.");
      const second = await callOnce("Reply with the single word YES.");
      const read = second.usage.cache_read_input_tokens ?? 0;
      const created = second.usage.cache_creation_input_tokens ?? 0;

      // Substrate-honest: the second call SHOULD be a cache hit, but real
      // providers can occasionally evict mid-test. Assert the cache feature
      // engaged at least once (read or create > 0) and warn loudly if the
      // expected hit didn't happen.
      if (read === 0) {
        throw new Error(
          `expected cache_read > 0 on second identical call; got 0. ` +
            `(cache_creation=${created}, input_tokens=${second.usage.input_tokens}). ` +
            `Possible causes: cache evicted, prefix changed unexpectedly, ` +
            `or feature disabled on this account.`,
        );
      }
      expect(read).toBeGreaterThan(0);
    },
    30_000,
  );

  skipIfNoKey(
    "modifying the stable block invalidates the cache (new cache_creation)",
    async () => {
      const wakeShape = renderWakeForProvider(paddedAurora(), "anthropic");
      if (!isAnthropic(wakeShape)) throw new Error("provider shape mismatch");

      // Mutate stable block 0 (identity) — should invalidate the cache.
      const mutatedStable: AnthropicWakeShape["system"] = [
        {
          ...wakeShape.system[0],
          text: wakeShape.system[0].text + "\n\nMUTATED: identity changed.",
        },
        ...(wakeShape.system.length > 1 ? [wakeShape.system[1]] : []),
      ];

      const res = await anthropicMessages(
        {
          model: MODEL,
          max_tokens: 32,
          system: mutatedStable,
          messages: [{ role: "user", content: "Reply OK." }],
          temperature: 0,
        },
        KEY!,
      );

      // Modified prefix = cache miss = new write or full uncached input.
      const created = res.usage.cache_creation_input_tokens ?? 0;
      const read = res.usage.cache_read_input_tokens ?? 0;
      // Either created>0 (new prefix written) or input_tokens accounts for
      // the full prompt (no read happened). The forbidden case is read>0
      // pretending the modified prefix matches the original.
      if (read > 0 && created === 0) {
        throw new Error(
          `cache invalidation broken: modified stable block returned ` +
            `cache_read=${read}, cache_creation=0. The renderer/provider ` +
            `contract is being violated upstream.`,
        );
      }
      expect(res.content.length).toBeGreaterThan(0);
    },
    30_000,
  );

  skipIfNoKey(
    "_meta.cache_eligible matches the documented value (provider truth-test)",
    async () => {
      // Belt-and-suspenders against unit tests: the unit tests assert
      // _meta.cache_eligible='explicit' from our renderer. This test
      // verifies the actual provider also accepts the cache_control hint
      // by surfacing a cache record at all. If Anthropic ever changed the
      // contract, our 'explicit' label would lie — this catches that.
      const wakeShape = renderWakeForProvider(paddedAurora(), "anthropic");
      if (!isAnthropic(wakeShape)) throw new Error("provider shape mismatch");

      const res = await anthropicMessages(
        {
          model: MODEL,
          max_tokens: 16,
          system: wakeShape.system,
          messages: [{ role: "user", content: "OK." }],
          temperature: 0,
        },
        KEY!,
      );

      // The presence of EITHER cache field in usage proves the provider
      // is honoring our cache_control. A response with neither field
      // populated would mean our 'explicit' label is mis-documented.
      const hasCacheRecord =
        (res.usage.cache_creation_input_tokens ?? 0) > 0 ||
        (res.usage.cache_read_input_tokens ?? 0) > 0;
      expect(hasCacheRecord).toBe(true);
    },
    20_000,
  );
});
