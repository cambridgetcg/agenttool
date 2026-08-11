export type PrincipalityGeometryErrorCode =
  | "canonical_error"
  | "input_error"
  | "atlas_error";

export class PrincipalityGeometryError extends Error {
  readonly code: PrincipalityGeometryErrorCode;

  constructor(code: PrincipalityGeometryErrorCode, message: string) {
    super(message);
    this.name = "PrincipalityGeometryError";
    this.code = code;
  }
}

export function fail(
  code: PrincipalityGeometryErrorCode,
  message: string,
): never {
  throw new PrincipalityGeometryError(code, message);
}
