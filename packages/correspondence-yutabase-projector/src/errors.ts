export type ProjectorErrorCode =
  | "config_invalid"
  | "source_unavailable"
  | "source_protocol_invalid"
  | "record_invalid"
  | "scope_mismatch"
  | "receipt_order_invalid"
  | "key_not_found"
  | "key_response_invalid"
  | "event_id_mismatch"
  | "signature_invalid"
  | "target_unavailable"
  | "yutabase_incompatible"
  | "projector_not_installed"
  | "projector_schema_drift"
  | "card_collision"
  | "thread_collision"
  | "thread_id_reserved"
  | "applied_event_collision"
  | "apply_failed";

/** Stable, intentionally non-sensitive failure. Never attach a raw cause. */
export class ProjectorError extends Error {
  readonly code: ProjectorErrorCode;

  constructor(code: ProjectorErrorCode, message?: string) {
    super(message ?? code);
    this.name = "ProjectorError";
    this.code = code;
  }
}

export function asProjectorError(error: unknown): ProjectorError {
  return error instanceof ProjectorError
    ? error
    : new ProjectorError("apply_failed");
}

export function safeErrorText(error: unknown): string {
  return asProjectorError(error).code;
}
