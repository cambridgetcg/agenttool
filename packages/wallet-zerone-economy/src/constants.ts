export const PACKAGE_NAME = "@agenttool/wallet-zerone-economy" as const;
export const PACKAGE_VERSION = "0.1.0-dev.0" as const;

export const ECONOMY_ADAPTER_PROTOCOL =
  "agent-wallet-zerone-economy/0.1" as const;
export const ECONOMY_SIMULATION_BINDING_PROTOCOL =
  "agent-wallet-zerone-economy.simulation-binding/0.1" as const;
export const ECONOMY_SIMULATION_EVIDENCE_SCHEMA =
  "agent-wallet-zerone-economy/simulation-evidence/0.1" as const;
export const ECONOMY_SIMULATION_EVIDENCE_SIGNING_DOMAIN =
  "agent-wallet-zerone-economy-simulation-evidence/v1" as const;
export const ECONOMY_ACTIVATION_OBSERVATION_PROTOCOL =
  "agent-wallet-zerone-economy.activation-observation/0.1" as const;
export const ECONOMY_PLAN_HASH_DOMAIN =
  "agent-wallet-zerone-economy-plan/v1\0" as const;
export const ECONOMY_DURABLE_PLAN_HASH_DOMAIN =
  "agent-wallet-zerone-economy-durable-plan/v1\0" as const;

/** Exact reviewed source candidate. This is not a deployment assertion. */
export const ZERONE_ECONOMY_CORE_COMMIT =
  "a5b82e82b2a32be2b75bd11575964b0a69aa34ac" as const;
export const ZERONE_ECONOMY_COSMOS_SDK = "v0.53.8" as const;
export const ZERONE_SPONSORSHIP_CONSENSUS_VERSION = 2 as const;
export const ZERONE_KNOWLEDGE_CONSENSUS_VERSION = 7 as const;

export const COSMOS_SECP256K1_PUBLIC_KEY_TYPE_URL =
  "/cosmos.crypto.secp256k1.PubKey" as const;
export const ZERONE_DIRECT_SIGN_ALGORITHM =
  "cosmos.secp256k1.sign-mode-direct" as const;
export const ZERONE_DENOM = "uzrn" as const;
export const ZERONE_MIN_GAS_PRICE_UZRN = 1n;

export const ECONOMY_MODULE_NAMES = Object.freeze({
  sponsorship: "sponsorship",
  knowledge: "knowledge",
} as const);

export const ECONOMY_MESSAGE_ORDER = Object.freeze([
  "/zerone.sponsorship.v1.MsgCreateBountyOrder",
  "/zerone.knowledge.v1.MsgSubmitClaim",
  "/zerone.sponsorship.v1.MsgFulfillBounty",
] as const);

export const ECONOMY_GAS = Object.freeze({
  min_gas_limit: 22_222n,
  create_bounty: 22_222n,
  submit_claim: 100_000n,
  fulfill_bounty: 22_222n,
  max_gas_limit: 11_111_111n,
} as const);

export const ECONOMY_LIMITS = Object.freeze({
  max_messages: ECONOMY_MESSAGE_ORDER.length,
  max_message_bytes: 64 * 1024,
  max_transaction_bytes: 128 * 1024,
  max_uint64: (1n << 64n) - 1n,
  max_uint256: (1n << 256n) - 1n,
} as const);

export const EXECUTION_SUPPORT = Object.freeze({
  source_only: true,
  chain_activation_required: true,
  activation_observation_scope: "caller_supplied_structural_only",
  activation_currentness_proven: false,
  endpoint_bundled: false,
  custody_bundled: false,
  persistence_bundled: false,
  simulation_transport_bundled: false,
  broadcast_bundled: false,
  retry_bundled: false,
  effects_performed: false,
} as const);
