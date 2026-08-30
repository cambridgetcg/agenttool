import type { HfScoutLimits } from "./types.js";

export const TOOL_NAME = "@agenttool/hf-scout" as const;
export const TOOL_VERSION = "0.2.0-dev.1" as const;
export const ARTIFACT_SCHEMA = "agenttool-hf-artifact/v0.2" as const;
export const REPORT_SCHEMA = "agenttool-hf-scout-report/v0.2" as const;
export const SEARCH_SCHEMA = "agenttool-hf-scout-search/v0.2" as const;
export const SIDECAR_SCHEMA = "kingdom-hf-sidecar/v0.2" as const;
export const RECONCILIATION_SCHEMA = "agenttool-hf-release-reconciliation/v0.2" as const;
export const RESEARCH_CATALOG_SCHEMA = "agenttool-hf-research-catalog/v0.1" as const;
export const RESEARCH_LEAD_SCHEMA = "agenttool-hf-research-lead/v0.1" as const;
export const RESEARCH_BINDING_SCHEMA = "agenttool-hf-research-binding/v0.1" as const;
export const LOVE_MODEL_LOCK_SCHEMA = "love.huggingface-model-lock/v1" as const;
export const HF_ORIGIN = "https://huggingface.co" as const;

export const DEFAULT_LIMITS: HfScoutLimits = Object.freeze({
  timeout_ms: 10_000,
  max_response_bytes: 1_048_576,
  max_search_results: 20,
  max_files: 1_000,
  max_tags: 200,
});
