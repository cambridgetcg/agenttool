import type { ConformanceBoundaries, OfficialVectorManifest } from "./types.js";

export const PACKAGE_NAME = "@agenttool/economic-conformance" as const;
export const PACKAGE_VERSION = "0.2.0-dev.0" as const;
export const CONFORMANCE_PROTOCOL = "agenttool.economic-conformance/0.2" as const;
export const OFFICIAL_SUITE_ID = "suite:economic-kernel-v0.2" as const;
export const OFFICIAL_SUITE_REVISION = "1" as const;
export const OFFICIAL_SUITE_SEMANTIC_SHA256 = "sha256:4ab116811eded993e0a1156970dac917515e039a1b651fe408f832c008e7ee43" as const;
export const OFFICIAL_VECTOR_PATH = "economic-kernel-v0.2.json" as const;
export const OFFICIAL_VECTOR_BYTES = 22_842 as const;
export const OFFICIAL_VECTOR_RAW_SHA256 = "sha256:2c13fd9f341210657de0f1fc223c22c82472ca6377a9af3dce28c9db035ae47b" as const;
export const OFFICIAL_VECTOR_CASE_COUNT = 53 as const;
export const OFFICIAL_VECTOR_MANIFEST_BYTES = 491 as const;
export const OFFICIAL_VECTOR_MANIFEST_RAW_SHA256 = "sha256:905479c1ff530892c4930b59b03af586846b43c9f7043b58e0706a8764e25fc7" as const;

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
