export type ZeroneAgentHostErrorCode =
  | "authorization_denied"
  | "conflict"
  | "evidence_rejected"
  | "execution_unsupported"
  | "file_error"
  | "integrity_error"
  | "invalid_input"
  | "not_found"
  | "sequence_fenced"
  | "state_conflict"
  | "treasury_denied";

export class ZeroneAgentHostError extends Error {
  readonly code: ZeroneAgentHostErrorCode;

  constructor(code: ZeroneAgentHostErrorCode, message: string) {
    super(message);
    this.name = "ZeroneAgentHostError";
    this.code = code;
  }
}

export function fail(code: ZeroneAgentHostErrorCode, message: string): never {
  throw new ZeroneAgentHostError(code, message);
}
