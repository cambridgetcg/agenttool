import type {
  SEARCH_INSPECTION_SCHEMA,
  SEARCH_SCHEMA,
  UNTRUSTED_SEARCH_NOTE,
} from "./constants.js";
import type { TelescopeReport } from "@agenttool/telescope";

export type SearchKind =
  | "web"
  | "agent"
  | "capability"
  | "mcp_server"
  | "tool"
  | "package"
  | "documentation"
  | "other";

export interface SearchLimits {
  max_query_chars: number;
  default_results: number;
  max_results: number;
  max_providers: number;
  max_provider_results: number;
  max_title_chars: number;
  max_summary_chars: number;
  max_url_chars: number;
  max_capabilities: number;
  max_claims: number;
  max_evidence: number;
  default_deadline_ms: number;
  max_deadline_ms: number;
  session_ttl_ms: number;
  max_stored_queries: number;
}

export interface SearchOptions {
  signal?: AbortSignal;
}

export type SearchClaimValue =
  | string
  | number
  | boolean
  | null
  | readonly string[];

export type SearchClaimBasis =
  | "publisher_assertion"
  | "provider_assertion"
  | "transport_observation"
  | "local_derivation";

export interface ProviderClaim {
  key: string;
  value: SearchClaimValue;
  basis: SearchClaimBasis;
}

export interface ProviderScore {
  value: number;
  basis: string;
}

export interface ProviderCandidate {
  kind: SearchKind;
  title: string;
  summary: string;
  target_url: string;
  inspect_url?: string;
  mime_type?: string;
  capabilities?: readonly string[];
  published_at?: string;
  modified_at?: string;
  provider_score?: ProviderScore;
  claims?: readonly ProviderClaim[];
}

export interface ProviderTransportObservation {
  request_url: string;
  final_url: string;
  status: number;
  media_type: string | null;
  bytes: number;
  sha256: string;
  boundary_codes: readonly string[];
}

export interface ProviderSearchBatch {
  results: readonly ProviderCandidate[];
  next_cursor?: string;
  observation: ProviderTransportObservation;
}

export interface ProviderBoundary {
  mode: string;
  credentials: "omitted" | "provider_owned";
  query_disclosed: true;
  connected_address_pinning: boolean;
  statement: string;
}

export interface ProviderSearchRequest {
  query: string;
  kinds: readonly SearchKind[];
  limit: number;
  cursor?: string;
}

export interface ProviderContext {
  observed_at: string;
  signal: AbortSignal;
}

export interface SearchProvider {
  readonly id: string;
  readonly kinds: readonly SearchKind[];
  readonly boundary: ProviderBoundary;
  search(
    request: ProviderSearchRequest,
    context: ProviderContext,
  ): Promise<ProviderSearchBatch>;
}

export type SearchInput =
  | {
      query: string;
      provider_ids?: readonly string[];
      kinds?: readonly SearchKind[];
      limit?: number;
      deadline_ms?: number;
      cursor?: never;
    }
  | {
      cursor: string;
      query?: never;
      provider_ids?: never;
      kinds?: never;
      limit?: never;
      deadline_ms?: number;
    };

export interface SearchEvidence {
  evidence_id: string;
  provider_id: string;
  observed_at: string;
  basis: "transport_observation";
  request: {
    method: "GET";
    url: string;
    query_values_redacted: true;
  };
  response: {
    status: number;
    final_url: string;
    query_values_redacted: true;
    media_type: string | null;
    bytes: number;
    sha256: string;
  };
  untrusted: true;
  boundary_codes: string[];
}

export interface SearchClaim extends ProviderClaim {
  provider_id: string;
  evidence_ids: string[];
  untrusted: true;
}

export interface SearchRankSignal {
  provider_id: string;
  provider_rank: number;
  provider_score: ProviderScore | null;
}

interface SearchFollowupBase {
  label: string;
  session_id: string;
  result_id: string;
  automatic: false;
  requires_explicit_choice: true;
  authority: "none";
}

export type SearchFollowup =
  | (SearchFollowupBase & {
      id: "inspect";
      operation: "agent_inspect";
    })
  | (SearchFollowupBase & {
      id: "plan";
      operation: "browser_plan_result";
    })
  | (SearchFollowupBase & {
      id: "open";
      operation: "browser_open_result";
    });

export interface SearchResult {
  result_id: string;
  kind: SearchKind;
  title: string;
  summary: string;
  display_url: string;
  origin: string;
  mime_type: string | null;
  capabilities: string[];
  published_at: string | null;
  modified_at: string | null;
  rank: {
    position: number;
    method: "reciprocal_rank_fusion";
    signals: SearchRankSignal[];
    explanation: string;
  };
  claims: SearchClaim[];
  evidence_ids: string[];
  followups: SearchFollowup[];
  untrusted: true;
  trust: "untrusted";
  authority: "none";
  automatic_action: "never";
}

export interface SearchProviderObservation {
  provider_id: string;
  state: "complete" | "error" | "timeout";
  result_count: number;
  next_cursor_present: boolean;
  boundary: ProviderBoundary;
  evidence_ids: string[];
  diagnostic_codes: string[];
}

export interface SearchDiagnostic {
  code: string;
  level: "warning" | "error";
  provider_id: string | null;
  message: string;
}

export interface SearchResponse {
  schema: typeof SEARCH_SCHEMA;
  session_id: string;
  query_id: string;
  observed_at: string;
  expires_at: string;
  status: "complete" | "partial" | "inconclusive";
  partial: boolean;
  query: {
    text: string;
    kinds: SearchKind[];
    providers: string[];
  };
  privacy: {
    query_sent_to: string[];
    provider_logging_and_retention: "not_evaluated";
    warning: string;
  };
  effective_limits: {
    results: number;
    deadline_ms: number;
    providers: number;
  };
  results: SearchResult[];
  providers: SearchProviderObservation[];
  evidence: SearchEvidence[];
  diagnostics: SearchDiagnostic[];
  next_cursor: string | null;
  untrusted: true;
  trust: "untrusted";
  authority: "none";
  automatic_action: "never";
  note: typeof UNTRUSTED_SEARCH_NOTE;
}

export interface SearchInspection {
  schema: typeof SEARCH_INSPECTION_SCHEMA;
  session_id: string;
  result_id: string;
  inspected_at: string;
  inspector: "@agenttool/telescope";
  origin: string;
  report: TelescopeReport;
  untrusted: true;
  trust: "untrusted";
  authority: "none";
  automatic_action: "never";
}

export interface OpenSearchResultInput {
  session_id: string;
  result_id: string;
}

export interface InspectSearchResultInput {
  session_id: string;
  result_id: string;
}
