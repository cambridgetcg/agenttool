export type RelationalGeometryErrorCode =
  | "complex_error"
  | "invalid_json"
  | "lens_error";

export class RelationalGeometryError extends Error {
  readonly code: RelationalGeometryErrorCode;

  constructor(code: RelationalGeometryErrorCode, message: string) {
    super(message);
    this.name = "RelationalGeometryError";
    this.code = code;
  }
}

export function fail(code: RelationalGeometryErrorCode, message: string): never {
  throw new RelationalGeometryError(code, message);
}
