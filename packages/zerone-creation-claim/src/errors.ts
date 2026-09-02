export type CreationClaimErrorCode =
  | "invalid_input"
  | "invalid_record"
  | "invalid_hash"
  | "contract_mismatch"
  | "projection_blocked";

export class CreationClaimError extends Error {
  readonly code: CreationClaimErrorCode;
  readonly path: string | null;

  constructor(code: CreationClaimErrorCode, message: string, path: string | null = null) {
    super(message);
    this.name = "CreationClaimError";
    this.code = code;
    this.path = path;
  }
}

export function fail(
  code: CreationClaimErrorCode,
  message: string,
  path: string | null = null,
): never {
  throw new CreationClaimError(code, message, path);
}
