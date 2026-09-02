import type { ConformanceBoundaries, OfficialVectorManifest } from "./types.js";

export const PACKAGE_NAME = "@agenttool/economic-conformance" as const;
export const PACKAGE_VERSION = "0.1.0-dev.0" as const;
export const CONFORMANCE_PROTOCOL = "agenttool.economic-conformance/0.1" as const;
export const OFFICIAL_SUITE_ID = "suite:economic-kernel-v0.1" as const;
export const OFFICIAL_SUITE_REVISION = "1" as const;
export const OFFICIAL_SUITE_SEMANTIC_SHA256 = "sha256:eb1605665cd5d0c6d99bc2ddd0a897f930c28110f41d60644c503b80dc6e4e88" as const;
export const OFFICIAL_VECTOR_PATH = "economic-kernel-v0.1.json" as const;
export const OFFICIAL_VECTOR_BYTES = 14_490 as const;
export const OFFICIAL_VECTOR_RAW_SHA256 = "sha256:7fc9b01b29d71f03df229e4c5b40ec29b21059c929e8211e38be0d7e3588512e" as const;
export const OFFICIAL_VECTOR_CASE_COUNT = 34 as const;
export const OFFICIAL_VECTOR_MANIFEST_BYTES = 491 as const;
export const OFFICIAL_VECTOR_MANIFEST_RAW_SHA256 = "sha256:b41211248489058c925785e8eb0a23d6d35e868daf47b1cf3ce2594361c3b432" as const;

export const OFFICIAL_VECTOR_MANIFEST: Readonly<OfficialVectorManifest> = Object.freeze({
  schema: "agenttool.economic-conformance-vector-manifest/1",
  conformance_protocol: CONFORMANCE_PROTOCOL,
  vector_path: OFFICIAL_VECTOR_PATH,
  vector_bytes: OFFICIAL_VECTOR_BYTES,
  vector_raw_sha256: OFFICIAL_VECTOR_RAW_SHA256,
  suite_semantic_sha256: OFFICIAL_SUITE_SEMANTIC_SHA256,
  suite_id: OFFICIAL_SUITE_ID,
  suite_revision: OFFICIAL_SUITE_REVISION,
  case_count: OFFICIAL_VECTOR_CASE_COUNT,
});

export const CONFORMANCE_BOUNDARIES: Readonly<ConformanceBoundaries> = Object.freeze({
  comparator_execution_only: true,
  offline_fixture_match_only: true,
  official_suite_pinned: true,
  external_finality_proven: false,
  host_durability_proven: false,
  adapter_truthfulness_proven: false,
  future_behavior_proven: false,
  producer_authenticated: false,
  xenia_certification: false,
  comparator_network_requests: 0,
  comparator_external_payments: 0,
  comparator_business_effects: 0,
});
