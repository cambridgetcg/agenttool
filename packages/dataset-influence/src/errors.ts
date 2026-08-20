export type DatasetInfluenceErrorCode =
  | "canonical_error"
  | "invalid_input"
  | "invalid_artifact"
  | "math_unavailable";

export class DatasetInfluenceError extends Error {
  readonly code: DatasetInfluenceErrorCode;

  constructor(code: DatasetInfluenceErrorCode, message: string) {
    super(message);
    this.name = "DatasetInfluenceError";
    this.code = code;
  }
}

export function fail(code: DatasetInfluenceErrorCode, message: string): never {
  throw new DatasetInfluenceError(code, message);
}
