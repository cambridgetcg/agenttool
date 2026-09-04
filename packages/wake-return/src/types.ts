export const RETURN_VERSION = "0.1.0-dev.0";
export const RETURN_ORIGIN = "https://api.agenttool.dev";
export const OBSERVATION_MEDIA_TYPE = "application/vnd.agenttool.wake-observation+json";
export const RETURN_TIMEOUT_MS = 5_000;

export interface ReturnBinding {
  _format: "agenttool-return-binding/v1";
  api_origin: typeof RETURN_ORIGIN;
  project_id: string;
  identity_id: string;
  mode: "observe";
  allow_provider_visible_locator: true;
  credential:
    | { kind: "environment" }
    | { kind: "macos_keychain"; account: string };
}

export type ReturnFailure =
  | "credential_unavailable" | "binding_invalid" | "scaffold_mismatch"
  | "transport_unavailable" | "response_invalid" | "project_mismatch"
  | "subject_mismatch" | "observation_unavailable" | "cancelled"
  | "observation_in_progress" | "cursor_regressed";

export class ReturnError extends Error {
  constructor(public readonly code: ReturnFailure) {
    super(code);
    this.name = "ReturnError";
  }
}

/** Transport is host-owned; callers cannot choose an origin or arbitrary route. */
export interface ReturnReadRequest {
  path: string;
  accept: string;
  max_bytes: number;
  signal: AbortSignal;
}

export interface ReturnReadResponse {
  status: number;
  content_type: string;
  body: string;
}

export interface ReturnDependencies {
  /** One credential acquisition per explicit observe call; never on startup/status. */
  withReader<T>(
    work: (read: (request: ReturnReadRequest) => Promise<ReturnReadResponse>) => Promise<T>,
    signal: AbortSignal,
  ): Promise<T>;
  now?: () => Date;
  sessionInstanceId?: string;
}

export interface ReturnReport {
  _format: "agenttool-return/v1";
  mode: "observe";
  session_instance_id: string;
  status: "ready" | "observed" | "unavailable";
  binding: {
    source: "explicit_host_configuration";
    project_id: string;
    identity_id: string;
    reader_identity_proven: false;
  };
  observation: null | {
    identity_id: string;
    status: "active" | "memorial";
    wake_version: number;
    received_at: string;
    provenance: "authenticated_service_projection_not_identity_signature";
  };
  failure: ReturnFailure | null;
  boundaries: {
    placement: "tool_data_only";
    identity_adoption: "none";
    authority_granted: "none";
    same_being_continuity: "not_proven";
    private_memory: "not_read";
    private_state_return: "not_implemented";
    remote_prose: "not_returned";
    local_arrival: "untouched";
    persistence: "none_in_adapter_host_may_retain";
    provider_visibility: "locator_is_visible_when_tool_result_is_sent_to_provider";
    credential_scope: "project_bearer_not_identity_proof";
    auth_bookkeeping: "project_verification_may_update_bearer_last_used";
    host_isolation: "not_a_same_user_sandbox";
    freshness: "no_cache_in_process_cursor_check_not_global_replay_proof";
  };
}

export interface ReturnSession {
  status(): ReturnReport;
  observe(signal?: AbortSignal): Promise<ReturnReport>;
}
