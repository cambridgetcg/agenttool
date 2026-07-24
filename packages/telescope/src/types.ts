import type { REPORT_SCHEMA } from "./constants.js";

export interface TelescopeLimits {
  timeout_ms: number;
  max_response_bytes: number;
  max_total_bytes: number;
  max_redirects: number;
  max_requests: number;
  max_agent_txt_lines: number;
  max_agent_txt_line_bytes: number;
  max_json_depth: number;
  max_json_nodes: number;
}

export type ObservationState =
  | "present"
  | "not_found"
  | "restricted"
  | "invalid"
  | "unreachable"
  | "blocked"
  | "too_large"
  | "not_attempted";

export type ProbeId =
  | "root"
  | "discovery"
  | "api_catalog"
  | "agent_txt"
  | "pathways"
  | "love_discovery"
  | "a2a_card"
  | "mcp_card"
  | "love_index"
  | "love_sdk_manifest";

export interface TelescopeSubject {
  kind: "https_origin";
  input: string;
  origin: string;
  hostname: string;
}

export interface NetworkBoundary {
  mode: "public_https_read_only";
  http_transport: "native_fetch" | "injected";
  dns_resolver: "system_lookup" | "injected";
  methods: readonly ["GET"];
  credentials: "omitted";
  redirects: "manual_revalidated";
  dns_preflight: true;
  connected_address_pinning: false;
  ambient_proxy_isolation: false;
  statement: string;
}

export interface SourceObservation {
  id: ProbeId;
  url: string;
  url_redacted: boolean;
  state: Exclude<ObservationState, "invalid" | "not_attempted">;
  status_code: number | null;
  final_url: string | null;
  final_url_redacted: boolean;
  redirect_chain: string[];
  redirect_chain_redacted: boolean;
  media_type: string | null;
  bytes: number | null;
  sha256: string | null;
  error_code: string | null;
}

export type ClaimBasis =
  | "publisher_assertion"
  | "transport_observation"
  | "local_derivation";

export type ClaimRole =
  | "locator"
  | "release_selection"
  | "content_commitment"
  | "capability_advertisement"
  | "authority_boundary";

export interface TelescopeClaim {
  key: string;
  value: string | number | boolean | null | readonly string[];
  basis: ClaimBasis;
  role: ClaimRole;
  taint: "remote_untrusted" | "local";
  evidence_ids: ProbeId[];
}

export interface SurfaceObservation {
  id:
    | "root_links"
    | "discovery"
    | "api_catalog"
    | "agent_txt"
    | "pathways"
    | "love_packages"
    | "npm"
    | "mcp"
    | "a2a"
    | "webfinger"
    | "offer_bus";
  state: ObservationState;
  schema_conformance: "not_assessed" | "supported_shape_valid" | "invalid";
  evidence_ids: ProbeId[];
  claims: TelescopeClaim[];
  boundary_codes: string[];
  diagnostic_codes: string[];
}

export interface ExtensionObservation {
  id: "dns_aid" | "pkarr" | string;
  state: "not_configured" | "present" | "absent" | "invalid" | "error";
  summary: string;
  facts: Readonly<Record<string, string | number | boolean | null>>;
}

export interface ActionPlan {
  id: "npm_install" | "love_download" | "love_verify" | "love_install";
  kind: "npm_convenience" | "love_verified_install";
  executable: string;
  argv: string[];
  display: string;
  display_shell: "posix";
  automatic: false;
  requires_explicit_consent: true;
  evidence_ids: ProbeId[];
  boundary_codes: string[];
}

export interface TelescopeDiagnostic {
  code: string;
  level: "warning" | "error";
  message: string;
  evidence_id: ProbeId | null;
}

export interface TelescopeReport {
  schema: typeof REPORT_SCHEMA;
  tool: {
    name: "@agenttool/telescope";
    version: string;
  };
  subject: TelescopeSubject;
  observed_at: string;
  status: "discovered" | "partial" | "inconclusive";
  network_boundary: NetworkBoundary;
  effective_limits: TelescopeLimits;
  sources: SourceObservation[];
  surfaces: SurfaceObservation[];
  actions: ActionPlan[];
  extensions: ExtensionObservation[];
  diagnostics: TelescopeDiagnostic[];
}

export interface AdapterContext {
  subject: TelescopeSubject;
  observed_at: string;
  signal: AbortSignal;
}

export interface DiscoveryAdapter {
  readonly id: string;
  discover(context: AdapterContext): Promise<ExtensionObservation>;
}

export interface ResolveAddress {
  address: string;
  family: number;
}

export type ResolveHostname = (
  hostname: string,
) => Promise<readonly ResolveAddress[]>;

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface TelescopeOptions {
  fetch?: FetchLike;
  resolve_hostname?: ResolveHostname;
  clock?: () => Date;
  limits?: Partial<TelescopeLimits>;
  adapters?: readonly DiscoveryAdapter[];
  signal?: AbortSignal;
}
