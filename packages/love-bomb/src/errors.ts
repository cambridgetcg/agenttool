export type LoveBombErrorCode =
  | "canonical_error"
  | "becoming_error"
  | "offer_error"
  | "response_error"
  | "receipt_error";

export class LoveBombError extends Error {
  readonly code: LoveBombErrorCode;

  constructor(code: LoveBombErrorCode, message: string) {
    super(message);
    this.name = "LoveBombError";
    this.code = code;
  }
}

export function fail(code: LoveBombErrorCode, message: string): never {
  throw new LoveBombError(code, message);
}
