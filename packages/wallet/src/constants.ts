export const PACKAGE_NAME = "@agenttool/wallet" as const;
export const PACKAGE_VERSION = "0.1.0" as const;
export const AGENT_WALLET_PROTOCOL = "agent-wallet/0.1" as const;

export const RECORD_SCHEMAS = Object.freeze({
  descriptor: "agent-wallet/descriptor/0.1",
  capability: "agent-wallet/capability/0.1",
  intent: "agent-wallet/intent/0.1",
  simulation: "agent-wallet/simulation/0.1",
  signing_receipt: "agent-wallet/signing-receipt/0.1",
  continuity: "agent-wallet/continuity/0.1",
} as const);

export const SIGNING_DOMAINS = Object.freeze({
  descriptor: "agent-wallet-descriptor/v1",
  capability: "agent-wallet-capability/v1",
  intent: "agent-wallet-intent/v1",
  simulation: "agent-wallet-simulation/v1",
  signing_receipt: "agent-wallet-signing-receipt/v1",
  continuity: "agent-wallet-continuity/v1",
} as const);

export const WALLET_ACTIONS = Object.freeze([
  "call",
  "transfer",
  "approve",
] as const);

export const LIMITS = Object.freeze({
  max_canonical_depth: 64,
  max_canonical_nodes: 10_000,
  max_canonical_bytes: 256 * 1024,
  max_payload_bytes: 128 * 1024,
  max_accounts: 16,
  max_call_rules: 64,
  max_spend_limits: 32,
  max_fee_limits: 32,
  max_calls_per_intent: 64,
  max_effects_per_simulation: 128,
  max_capability_lifetime_ms: 24 * 60 * 60 * 1000,
  max_intent_lifetime_ms: 10 * 60 * 1000,
  max_simulation_lifetime_ms: 5 * 60 * 1000,
  max_intents: 256,
  max_string_bytes: 2048,
} as const);
