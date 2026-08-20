export type AgentEconomyErrorCode =
  | "invalid_record"
  | "invalid_hash"
  | "invalid_amount"
  | "invalid_identity_binding"
  | "invalid_rotation"
  | "contract_mismatch"
  | "settlement_ineligible"
  | "treasury_denied"
  | "unsupported_adapter";

export class AgentEconomyError extends Error {
  readonly code: AgentEconomyErrorCode;
  readonly path: string | null;

  constructor(code: AgentEconomyErrorCode, message: string, path: string | null = null) {
    super(message);
    this.name = "AgentEconomyError";
    this.code = code;
    this.path = path;
  }
}

export function invalid(
  code: AgentEconomyErrorCode,
  message: string,
  path: string | null = null,
): never {
  throw new AgentEconomyError(code, message, path);
}
