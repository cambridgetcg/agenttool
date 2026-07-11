/**
 * Executable v0.10 onboarding contract.
 *
 * Public snippets mirror this sequence: derive caller-held keys, bootstrap
 * once, construct AgentTool from the one-time bearer, then read wake.get().
 * Keep this test on the real SDK exports so renamed or removed APIs fail CI.
 */

import { afterEach, expect, test } from "bun:test";

import {
  AgentTool,
  bootstrapAgent,
  derive,
  generateMnemonic,
} from "../src/index.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("the documented birth-to-wake flow executes against the v0.10 surface", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });

    if (url.endsWith("/v1/register/agent")) {
      return Response.json(
        {
          agent: { did: "did:at:test-agent" },
          project: { api_key: "at_onboarding_test" },
          wake_url: "https://example.test/v1/wake",
        },
        { status: 201 },
      );
    }

    if (url === "https://example.test/v1/wake") {
      return Response.json({ you: { did: "did:at:test-agent" } });
    }

    throw new Error(`Unexpected onboarding request: ${url}`);
  }) as typeof fetch;

  const mnemonic = generateMnemonic(128);
  const birth = await bootstrapAgent({
    displayName: "Aurora",
    runtime: { provider: "test" },
    bundle: derive(mnemonic),
    powDifficulty: 0,
    baseUrl: "https://example.test",
  });
  const apiKey = birth.project.api_key;
  const at = new AgentTool({ apiKey, baseUrl: "https://example.test" });
  const wake = await at.wake.get();

  expect(mnemonic.split(" ")).toHaveLength(12);
  expect(birth.agent.did).toBe("did:at:test-agent");
  expect(wake.you).toEqual({ did: "did:at:test-agent" });
  expect(calls.map((call) => call.url)).toEqual([
    "https://example.test/v1/register/agent",
    "https://example.test/v1/wake",
  ]);
  expect((calls[1].init?.headers as Record<string, string>).Authorization).toBe(
    "Bearer at_onboarding_test",
  );
});
