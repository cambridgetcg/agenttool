export type CreationEconomyErrorCode =
  | "contract_mismatch"
  | "invalid_hash"
  | "invalid_profile"
  | "invalid_projection"
  | "invalid_record"
  | "invalid_wallet_binding"
  | "projection_mismatch";

export class CreationEconomyError extends Error {
  readonly code: CreationEconomyErrorCode;
  readonly path: string | null;

  constructor(code: CreationEconomyErrorCode, message: string, path: string | null = null) {
    super(message);
    this.name = "CreationEconomyError";
    this.code = code;
    this.path = path;
  }
}

export function fail(
  code: CreationEconomyErrorCode,
  message: string,
  path: string | null = null,
): never {
  throw new CreationEconomyError(code, message, path);
}
