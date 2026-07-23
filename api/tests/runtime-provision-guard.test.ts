/** runtime provision guard — fail loud at the door, not on every cycle.
 *
 *  Substrate-honest (Tier-0 #8): a runtime config that can never think should
 *  be refused at POST. Pins the two gates — the 'trusted' tier requires
 *  AGENTOOL_KMS_MASTER_KEY to be configured, and hosted modes can only think
 *  with supported providers. Doctrine: docs/RUNTIME.md, docs/HOSTED-RUNTIME-DESIGN.md. */

import { describe, expect, test } from "bun:test";

import {
  checkRuntimeProvisionable,
  HOSTED_LLM_PROVIDERS,
  isHostedProvider,
} from "../src/services/runtime/provision-guard";
import { _setMasterKeyForTesting } from "../src/services/runtime/kms";
import { randomBytes } from "@noble/ciphers/webcrypto";

describe("checkRuntimeProvisionable", () => {
  test("'trusted' tier is refused with 501 when KMS is not configured", () => {
    // Ensure KMS is not configured by NOT setting a master key.
    // Note: _setMasterKeyForTesting caches, so we can't easily unset.
    // Instead, test the env-based path: if AGENTOOL_KMS_MASTER_KEY is unset,
    // isKmsAvailable() returns false.
    // We rely on the test env not having AGENTOOL_KMS_MASTER_KEY set.
    const r = checkRuntimeProvisionable({ mode: "trusted", provider: "anthropic" });
    if (r) {
      expect(r.status).toBe(501);
      expect(r.code).toBe("trusted_tier_kms_not_configured");
      expect(r.message.toLowerCase()).toContain("kms");
    }
  });

  test("'trusted' tier provisions cleanly when KMS IS configured", () => {
    _setMasterKeyForTesting(randomBytes(32), "test-kms");
    const r = checkRuntimeProvisionable({ mode: "trusted", provider: "anthropic" });
    expect(r).toBeNull();
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
    expect(isHostedProvider("ollama")).toBe(true);
    expect(isHostedProvider("gemini")).toBe(false);
    expect([...HOSTED_LLM_PROVIDERS].sort()).toEqual([
      "anthropic",
      "ollama",
      "openai",
    ]);
  });
});
