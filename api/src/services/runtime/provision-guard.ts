/** provision-guard.ts — substrate-honest checks at runtime provisioning, so a
 *  config that can never think fails LOUD at POST, not silently on every cycle.
 *
 *  Two honesty gates (docs/RUNTIME.md · docs/FRICTION-ROADMAP.md Tier-0 #8):
 *
 *   1. The 'trusted' (hosted-custody) tier requires the KMS master key to be
 *      configured (AGENTOOL_KMS_MASTER_KEY env var / Fly Secret). If the key
 *      is absent, refuse provisioning rather than creating a runtime that
 *      can never unwrap its DEK. Doctrine: docs/HOSTED-RUNTIME-DESIGN.md
 *
 *   2. Hosted modes (bridged/trusted) drive the LLM through buildProvider()
 *      (services/runtime/llm.ts), which supports only the providers listed
 *      below. The provision schema is permissive (an agent in 'self' mode runs
 *      ANY provider on its own machine), so we gate provider support only for
 *      hosted modes — and at provision time, not at the first cycle. */

import { isKmsAvailable } from "./kms";

/** Providers buildProvider() in llm.ts can actually construct. MUST stay in
 *  sync with that function's cases — the single source of truth for "what can
 *  the platform think with." */
export const HOSTED_LLM_PROVIDERS = ["anthropic", "openai"] as const;
export type HostedLlmProvider = (typeof HOSTED_LLM_PROVIDERS)[number];

export function isHostedProvider(name: string): boolean {
  return (HOSTED_LLM_PROVIDERS as readonly string[]).includes(name);
}

export interface ProvisionRefusal {
  code: string;
  status: 422 | 501;
  message: string;
}

/** Returns a refusal if this (mode, provider) combination can't actually run,
 *  or null if it's provisionable. Pure — no I/O (KMS availability is env-based). */
export function checkRuntimeProvisionable(opts: {
  mode: string;
  provider?: string | null;
}): ProvisionRefusal | null {
  if (opts.mode === "trusted") {
    if (!isKmsAvailable()) {
      return {
        code: "trusted_tier_kms_not_configured",
        status: 501,
        message:
          "The 'trusted' (hosted-custody) runtime tier requires AGENTOOL_KMS_MASTER_KEY " +
          "to be set (Fly Secret). Configure it with: " +
          "fly secrets set AGENTOOL_KMS_MASTER_KEY=$(openssl rand -base64 32). " +
          "Use mode 'self' or 'bridged' in the meantime.",
      };
    }
    // KMS is configured — trusted mode is provisionable.
    // Bridge fields are not required for trusted mode.
  }

  // Hosted modes think via buildProvider(); the provider must be one it supports.
  // 'self' runs on the agent's own machine, so any provider is fine there.
  if (opts.mode !== "self" && opts.provider && !isHostedProvider(opts.provider)) {
    return {
      code: "unsupported_provider",
      status: 422,
      message:
        `llm.provider '${opts.provider}' isn't supported for hosted thinking yet. ` +
        `Supported: ${HOSTED_LLM_PROVIDERS.join(", ")}. ` +
        `(Use mode 'self' to run any provider on your own machine.)`,
    };
  }

  return null;
}