export const RECEIPT_PROTOCOL = "zerone.constructive-evidence-receipt/v1" as const;
export const RECEIPT_MODE = "shadow_unfunded" as const;
export const TREE_SCHEMA = "zerone.constructive-intelligence-tree/v1" as const;
export const TREE_POLICY_VERSION = "1.0.0" as const;
export const TLS_QUEST_ID = "quest-tls-rfc9846-keyshare-reuse@1" as const;

export const REVIEWED_TREE_NORMATIVE_DIGEST =
  "43f65d91d700c9ed7a874f0a34520fc815d51d89a67255aa75f7e8be4ecd7a9a";
export const REVIEWED_TREE_RAW_DIGEST =
  "8070d8d1b7ea28a314f5a8550c675d7ccbe5d9b234ef02d54d4913c650c01aaf";
export const REVIEWED_TLS_QUEST_NORMATIVE_DIGEST =
  "bcefb7c2d177c79d135722bf38a689d122fe564eb39ebec873b0020dacb46206";
export const REVIEWED_TLS_QUEST_SCOPE_HASH =
  "cfb276b6a18ab0c1658317fbe2e495910d6b3199b139a1867d9e7e4d26d15fa8";

export const RECEIPT_ID_DOMAIN = RECEIPT_PROTOCOL;
export const PIN_ID_DOMAIN = "zerone.constructive-evidence-pin/v1";
export const EVENT_HASH_DOMAIN = "zerone.constructive-evidence-event/v1";
export const GENESIS_EVENT_HASH: `sha256:${string}` = `sha256:${"0".repeat(64)}`;

export const MAX_JSON_BYTES = 262_144;
export const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
export const MAX_JSON_DEPTH = 64;
export const MAX_JSON_NODES = 16_384;
export const MAX_STRING_BYTES = 8_192;

export const EVIDENCE_LEVELS = ["E0", "E1", "E2", "E3", "E4", "E5", "E6"] as const;
export const ADOPTION_RECEIPT_TYPES = [
  "maintained-fixture",
  "standards-disposition",
  "upstream-merge",
] as const;
