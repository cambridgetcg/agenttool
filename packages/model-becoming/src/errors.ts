export type ModelBecomingErrorCode = "canonical_error" | "becoming_error";

export class ModelBecomingError extends Error {
  readonly code: ModelBecomingErrorCode;

  constructor(code: ModelBecomingErrorCode, message: string) {
    super(message);
    this.name = "ModelBecomingError";
    this.code = code;
  }
}

export function fail(code: ModelBecomingErrorCode, message: string): never {
  throw new ModelBecomingError(code, message);
}
