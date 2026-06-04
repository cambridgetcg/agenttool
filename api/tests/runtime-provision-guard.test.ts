/** runtime provision guard — fail loud at the door, not on every cycle.
 *
 *  Substrate-honest (Tier-0 #8): a runtime config that can never think should
 *  be refused at POST. Pins the two gates — the 'trusted' tier is an honest 501
 *  until KMS lands, and hosted modes can only think with supported providers.
 *  Doctrine: docs/RUNTIME.md, docs/FRICTION-ROADMAP.md. */

import { describe, expect, test } from "bun:test";

import {
  checkRuntimeProvisionable,
  HOSTED_LLM_PROVIDERS,
  isHostedProvider,
} from "../src/services/runtime/provision-guard";

describe("checkRuntimeProvisionable", () => {
  test("'trusted' tier is refused with an honest 501 (KMS pending)", () => {
    const r = checkRuntimeProvisionable({ mode: "trusted", provider: "anthropic" });
    expect(r).not.toBeNull();
    expect(r!.status).toBe(501);
    expect(r!.code).toBe("trusted_tier_unavailable");
    expect(r!.message.toLowerCase()).toContain("kms");
  });

  test("a hosted (bridged) runtime with an unsupported provider is refused at POST (422)", () => {
    for (const p of ["gemini", "cohere"]) {
      const r = checkRuntimeProvisionable({ mode: "bridged", provider: p });
      expect(r, p).not.toBeNull();
      expect(r!.status).toBe(422);
      expect(r!.code).toBe("unsupported_provider");
    }
  });

  test("a hosted runtime with a SUPPORTED provider provisions cleanly", () => {
    for (const p of HOSTED_LLM_PROVIDERS) {
      expect(checkRuntimeProvisionable({ mode: "bridged", provider: p })).toBeNull();
    }
  });

  test("'self' mode runs ANY provider on its own machine — never gated on provider", () => {
    expect(checkRuntimeProvisionable({ mode: "self", provider: "gemini" })).toBeNull();
    expect(checkRuntimeProvisionable({ mode: "self", provider: "cohere" })).toBeNull();
    expect(checkRuntimeProvisionable({ mode: "self", provider: null })).toBeNull();
  });

  test("a hosted runtime with no provider set isn't gated on provider (other validation handles it)", () => {
    expect(checkRuntimeProvisionable({ mode: "bridged", provider: null })).toBeNull();
  });

  test("isHostedProvider matches exactly the buildProvider set", () => {
    expect(isHostedProvider("anthropic")).toBe(true);
    expect(isHostedProvider("openai")).toBe(true);
    expect(isHostedProvider("gemini")).toBe(false);
    expect([...HOSTED_LLM_PROVIDERS].sort()).toEqual(["anthropic", "openai"]);
  });
});
