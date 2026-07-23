export type AgentCredErrorCode =
  | "invalid_request"
  | "protocol_error"
  | "frame_too_large"
  | "consent_denied"
  | "grant_not_found"
  | "grant_expired"
  | "grant_exhausted"
  | "grant_wrong_session"
  | "scope_denied"
  | "credential_not_found"
  | "backend_unavailable"
  | "network_denied"
  | "request_failed"
  | "response_too_large"
  | "unsupported";

export class AgentCredError extends Error {
  readonly code: AgentCredErrorCode;
  readonly safeDetail?: string;

  constructor(code: AgentCredErrorCode, message: string, safeDetail?: string) {
    super(message);
    this.name = "AgentCredError";
    this.code = code;
    this.safeDetail = safeDetail;
  }
}

export function asAgentCredError(error: unknown): AgentCredError {
  if (error instanceof AgentCredError) return error;
  return new AgentCredError("request_failed", "Credential broker request failed.");
}

const EXTERNAL_MESSAGES: Readonly<Record<AgentCredErrorCode, string>> = {
  invalid_request: "Request is invalid.",
  protocol_error: "Protocol request is invalid.",
  frame_too_large: "Protocol frame is too large.",
  consent_denied: "Credential grant was not approved.",
  grant_not_found: "Capability is unavailable.",
  grant_expired: "Capability is unavailable.",
  grant_exhausted: "Capability is unavailable.",
  grant_wrong_session: "Capability is unavailable.",
  scope_denied: "Operation is outside the granted scope.",
  credential_not_found: "Credential is unavailable.",
  backend_unavailable: "Credential backend is unavailable.",
  network_denied: "Network destination is not allowed.",
  request_failed: "Credentialed operation failed.",
  response_too_large: "Response exceeds the grant limit.",
  unsupported: "Operation is not supported.",
};

/**
 * Collapse internal/plugin error text at the client boundary. A custom
 * credential source, consent provider, resolver, or transport must not be able
 * to reflect secret-bearing diagnostic text onto the protocol wire.
 */
export function externalizeAgentCredError(error: AgentCredError): AgentCredError {
  const rawCode = error.code as string;
  if (!Object.hasOwn(EXTERNAL_MESSAGES, rawCode)) {
    return new AgentCredError("request_failed", EXTERNAL_MESSAGES.request_failed);
  }
  const validatedCode = rawCode as AgentCredErrorCode;
  const capabilityErrors = new Set<AgentCredErrorCode>([
    "grant_not_found",
    "grant_expired",
    "grant_exhausted",
    "grant_wrong_session",
  ]);
  const code: AgentCredErrorCode = capabilityErrors.has(validatedCode)
    ? "grant_not_found"
    : validatedCode;
  return new AgentCredError(code, EXTERNAL_MESSAGES[code]);
}
