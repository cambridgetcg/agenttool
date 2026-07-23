import { afterEach, describe, expect, test } from "bun:test";

import {
  AgentTool,
  BOOTSTRAP_ELEVATE_SIGNATURE_CONTEXT,
  canonicalBootstrapElevateBytes,
  signBootstrapElevate,
} from "../src/index.js";

const ORIGINAL_FETCH = globalThis.fetch;
const PRIVATE_KEY = Uint8Array.from({ length: 32 }, (_, index) => index);
const VECTOR = {
  agent_id: "11111111-2222-3333-ABCD-555555555555",
  sponsor_did: "did:at:sponsor-α",
  sponsor_kid: "FFFFFFFF-1111-2222-3333-444444444444",
  initial_credits: 2500,
  claim: "sponsorship",
  evidence: "reviewed ✅",
};

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("bootstrap-elevate/v1 signing", () => {
  test("matches the shared API/TypeScript/Python digest and signature vector", () => {
    expect(BOOTSTRAP_ELEVATE_SIGNATURE_CONTEXT).toBe("bootstrap-elevate/v1");
    expect(Buffer.from(canonicalBootstrapElevateBytes(VECTOR)).toString("hex")).toBe(
      "156c8d8434659bd539c476f7124ab909494c8a08959b47eed15a9ad677f5115a",
    );
    expect(signBootstrapElevate(PRIVATE_KEY, VECTOR)).toBe(
      "lR9ikb3dNiD7uuY86mdQ2B6c0hk/p1/rxbrYVf3BkBKUSdCx5X8hlEw+akKOPZ0DOfW8PGqV5PleIZajjy+BAQ==",
    );
  });

  test("canonicalizes UUID case and keeps null distinct from empty text", () => {
    expect(canonicalBootstrapElevateBytes(VECTOR)).toEqual(
      canonicalBootstrapElevateBytes({
        ...VECTOR,
        agent_id: VECTOR.agent_id.toLowerCase(),
        sponsor_kid: VECTOR.sponsor_kid.toLowerCase(),
      }),
    );
    expect(canonicalBootstrapElevateBytes({ ...VECTOR, evidence: null }))
      .not.toEqual(canonicalBootstrapElevateBytes({ ...VECTOR, evidence: "" }));
  });

  test("rejects NUL, structured evidence, and counts astral text as code points", () => {
    expect(() => canonicalBootstrapElevateBytes({
      ...VECTOR,
      evidence: "proof\0suffix",
    })).toThrow();
    expect(() => canonicalBootstrapElevateBytes({
      ...VECTOR,
      evidence: { source: "json" } as unknown as string,
    })).toThrow();
    expect(() => canonicalBootstrapElevateBytes({
      ...VECTOR,
      evidence: "bad\ud800text",
    })).toThrow();
    expect(() => canonicalBootstrapElevateBytes({
      ...VECTOR,
      claim: "🧭".repeat(64),
    })).not.toThrow();
    expect(() => canonicalBootstrapElevateBytes({
      ...VECTOR,
      claim: "🧭".repeat(65),
    })).toThrow();
  });

  test("client sends every signed field and the explicit sponsor key", async () => {
    let sentBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ agent: { level: 1 } }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const at = new AgentTool({ apiKey: "test-key" });
    await at.bootstrap.elevate(VECTOR.agent_id, {
      sponsor_did: VECTOR.sponsor_did,
      sponsor_kid: VECTOR.sponsor_kid,
      sponsor_signature: signBootstrapElevate(PRIVATE_KEY, VECTOR),
      initial_credits: VECTOR.initial_credits,
      claim: VECTOR.claim,
      evidence: VECTOR.evidence,
    });

    expect(sentBody).toEqual({
      agent_id: VECTOR.agent_id,
      sponsor_did: VECTOR.sponsor_did,
      sponsor_kid: VECTOR.sponsor_kid,
      sponsor_signature:
        "lR9ikb3dNiD7uuY86mdQ2B6c0hk/p1/rxbrYVf3BkBKUSdCx5X8hlEw+akKOPZ0DOfW8PGqV5PleIZajjy+BAQ==",
      initial_credits: VECTOR.initial_credits,
      claim: VECTOR.claim,
      evidence: VECTOR.evidence,
    });
  });
});
