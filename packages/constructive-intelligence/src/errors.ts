export type ConstructiveErrorCode =
  | "argument_error"
  | "canonical_error"
  | "conflict"
  | "file_error"
  | "integrity_error"
  | "not_found"
  | "ordering_error"
  | "pin_error"
  | "receipt_error";

export class ConstructiveError extends Error {
  constructor(
    readonly code: ConstructiveErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ConstructiveError";
  }
}

export function fail(code: ConstructiveErrorCode, message: string): never {
  throw new ConstructiveError(code, message);
}
