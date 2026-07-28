export const PACKAGE_NAME = "@agenttool/wallet-zerone" as const;
export const PACKAGE_VERSION = "0.1.0" as const;
export const ZERONE_ADAPTER_PROTOCOL = "agent-wallet-zerone/0.1" as const;
export const ZERONE_CORE_COMMIT =
  "35284a22192df8fc6273135f14e8549c804778b6" as const;

export const ZERONE_DENOM = "uzrn" as const;
export const ZERONE_DISPLAY_DENOM = "ZRN" as const;
export const ZERONE_DECIMALS = 6 as const;
export const ZERONE_BIP44_COIN_TYPE = 118 as const;
export const ZERONE_BECH32_PREFIX = "zrn" as const;

export const ZERONE_MSG_SEND_TYPE_URL =
  "/cosmos.bank.v1beta1.MsgSend" as const;
export const ZERONE_MSG_SUBMIT_EXTERNAL_ATTESTATION_TYPE_URL =
  "/zerone.substrate_bridge.v1.MsgSubmitExternalAttestation" as const;
export const ZERONE_WALLET_METHOD_SUBMIT_EXTERNAL_ATTESTATION =
  "zerone.substrate_bridge.v1.MsgSubmitExternalAttestation" as const;
export const COSMOS_SECP256K1_PUBLIC_KEY_TYPE_URL =
  "/cosmos.crypto.secp256k1.PubKey" as const;
export const ZERONE_DIRECT_SIGN_ALGORITHM =
  "cosmos.secp256k1.sign-mode-direct" as const;

export const AGENTTOOL_ADAPTER_ID = "agenttool-invocation-v1" as const;
export const AGENTTOOL_WORK_CLASS_ID = "agenttool.invocation" as const;
export const SUBSTRATE_BRIDGE_MODULE_NAME = "substrate_bridge" as const;

export const ZERONE_LIMITS = Object.freeze({
  max_message_bytes: 64 * 1024,
  max_transaction_bytes: 128 * 1024,
  max_messages: 8,
  max_source_url_bytes: 2_048,
  max_transport_duration_ms: 30_000,
  default_transport_duration_ms: 10_000,
  max_transport_response_bytes: 2 * 1024 * 1024,
  // Pinned ZRNGasDecorator minimum before message-specific mapped costs.
  min_gas_limit: 22_222n,
  // Pinned app/gas.go transfer cost. MsgSubmitExternalAttestation is
  // intentionally unmapped and therefore pays min_gas_limit per message.
  msg_send_gas: 21_000n,
  msg_submit_external_attestation_gas: 22_222n,
  // zerone-core app/gas.go at the pinned commit.
  max_gas_limit: 11_111_111n,
  max_uint64: (1n << 64n) - 1n,
});
