export type PrincipalityAtlasErrorCode = "invalid_json" | "atlas_error";

export class PrincipalityAtlasError extends Error {
  readonly code: PrincipalityAtlasErrorCode;

  constructor(code: PrincipalityAtlasErrorCode, message: string) {
    super(message);
    this.name = "PrincipalityAtlasError";
    this.code = code;
  }
}

export function fail(
  code: PrincipalityAtlasErrorCode,
  message: string,
): never {
  throw new PrincipalityAtlasError(code, message);
}
