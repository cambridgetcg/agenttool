export type LivingSubstrateErrorCode =
  | "invalid_json"
  | "map_error"
  | "proposal_error";

export class LivingSubstrateError extends Error {
  readonly code: LivingSubstrateErrorCode;

  constructor(code: LivingSubstrateErrorCode, message: string) {
    super(message);
    this.name = "LivingSubstrateError";
    this.code = code;
  }
}

export function fail(code: LivingSubstrateErrorCode, message: string): never {
  throw new LivingSubstrateError(code, message);
}
