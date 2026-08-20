export type ZeroneEconomyPlannerErrorCode =
  | "invalid_input"
  | "unsupported_message"
  | "projection_mismatch"
  | "activation_mismatch"
  | "signer_mismatch"
  | "account_mismatch"
  | "gas_policy_mismatch"
  | "simulation_mismatch"
  | "signature_invalid"
  | "invalid_state";

export class ZeroneEconomyPlannerError extends Error {
  readonly code: ZeroneEconomyPlannerErrorCode;
  readonly path: string | null;

  constructor(
    code: ZeroneEconomyPlannerErrorCode,
    message: string,
    path: string | null = null,
  ) {
    super(message);
    this.name = "ZeroneEconomyPlannerError";
    this.code = code;
    this.path = path;
  }
}

export function fail(
  code: ZeroneEconomyPlannerErrorCode,
  message: string,
  path: string | null = null,
): never {
  throw new ZeroneEconomyPlannerError(code, message, path);
}
