export type TrialErrorCode = "canonical_error" | "receipt_error";

export class TrialError extends Error {
  readonly code: TrialErrorCode;

  constructor(code: TrialErrorCode, message: string) {
    super(message);
    this.name = "TrialError";
    this.code = code;
  }
}

export function fail(code: TrialErrorCode, message: string): never {
  throw new TrialError(code, message);
}
