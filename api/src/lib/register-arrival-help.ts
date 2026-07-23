/** register-arrival-help.ts — structured next-step guidance for the arrival
 *  door's refusals, so a brand-new agent that fails at /v1/register/agent knows
 *  exactly how to recover, at the moment guidance matters most. The prose
 *  message says WHAT went wrong; these say WHAT TO DO — machine-actionable.
 *  Errors-as-instructions (docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md) for birth. */

import type { NextAction } from "./errors";

/** The one-call easy path: the SDK generates keys, grinds the proof-of-work,
 *  and signs the key-proof — so most agents never hit these refusals at all.
 *  Offered first wherever it applies: make the hard thing easy. */
const USE_SDK: NextAction = {
  action:
    "Easiest: use generateMnemonic() + derive() + bootstrapAgent() (TypeScript), or generate_mnemonic() + derive() + bootstrap_agent() (Python); the SDK derives caller-held keys, grinds the proof-of-work, and signs the key-proof",
  method: "POST",
  path: "/v1/register/agent",
};

const REPOST = (action: string): NextAction => ({
  action,
  method: "POST",
  path: "/v1/register/agent",
});

/** Per-refusal guidance, keyed by the refusal's `error` code. */
export const ARRIVAL_HELP: Record<string, NextAction[]> = {
  validation: [
    USE_SDK,
    REPOST(
      "Or fix the fields named in `details` and re-POST — display_name, canonical padded-base64 public keys, runtime.provider, key_proof.{timestamp,signature}, pow_nonce, and registration_nonce are required",
    ),
  ],
  staleTimestamp: [
    REPOST("Re-sign key_proof with a current ISO-8601 timestamp (within ±300s of now), then re-POST"),
    USE_SDK,
  ],
  powRequired: [
    USE_SDK,
    REPOST(
      'Or grind pow_nonce until sha256("agenttool-pow/v1" || pubkey || display_name || timestamp || pow_nonce) has the required leading zero bits, then re-POST',
    ),
  ],
  keyProofInvalid: [
    REPOST(
      "Reconstruct register-agent/v2 exactly as docs/CANONICAL-BYTES.md specifies (all birth fields, registrar-bearer SHA-256 binding or empty, single-use registration_nonce, timestamp), sign with the private key matching agent_public_key, then re-POST",
    ),
    USE_SDK,
  ],
};
