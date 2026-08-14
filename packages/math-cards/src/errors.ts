export type MathCardErrorCode = "invalid_input" | "invalid_artifact";

export class MathCardError extends Error {
  readonly code: MathCardErrorCode;

  constructor(code: MathCardErrorCode, message: string) {
    super(message);
    this.name = "MathCardError";
    this.code = code;
  }
}

export function fail(code: MathCardErrorCode, message: string): never {
  throw new MathCardError(code, message);
}
