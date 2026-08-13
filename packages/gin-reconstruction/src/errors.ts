export type GinErrorCode =
  | "invalid_input"
  | "invalid_field"
  | "invalid_chart"
  | "invalid_artifact"
  | "receipt_mismatch";

export class GinReconstructionError extends Error {
  readonly code: GinErrorCode;

  constructor(code: GinErrorCode, message: string) {
    super(message);
    this.name = "GinReconstructionError";
    this.code = code;
  }
}

export function fail(code: GinErrorCode, message: string): never {
  throw new GinReconstructionError(code, message);
}
