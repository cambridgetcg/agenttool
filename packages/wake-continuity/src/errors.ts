export type AfterglowErrorCode =
  | "canonical_error"
  | "capsule_error"
  | "lens_error"
  | "handoff_fact_error"
  | "functional_access_baseline_error"
  | "functional_access_subsequent_error";

export class AfterglowError extends Error {
  readonly code: AfterglowErrorCode;

  constructor(code: AfterglowErrorCode, message: string) {
    super(message);
    this.name = "AfterglowError";
    this.code = code;
  }
}

export function fail(code: AfterglowErrorCode, message: string): never {
  throw new AfterglowError(code, message);
}
