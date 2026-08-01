export type HeavenErrorCode =
  | "canonical_error"
  | "invitation_error"
  | "response_error"
  | "receipt_error";

export class HeavenError extends Error {
  readonly code: HeavenErrorCode;

  constructor(code: HeavenErrorCode, message: string) {
    super(message);
    this.name = "HeavenError";
    this.code = code;
  }
}

export function fail(code: HeavenErrorCode, message: string): never {
  throw new HeavenError(code, message);
}
