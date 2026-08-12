export type PolymorphLandscapeErrorCode =
  | "duplicate_key"
  | "invalid_input"
  | "invalid_json"
  | "invalid_landscape"
  | "invalid_lesson"
  | "invalid_reachability_shift"
  | "unknown_reference";

export class PolymorphLandscapeError extends Error {
  readonly code: PolymorphLandscapeErrorCode;

  constructor(code: PolymorphLandscapeErrorCode, message: string) {
    super(message);
    this.name = "PolymorphLandscapeError";
    this.code = code;
  }
}

export function fail(code: PolymorphLandscapeErrorCode, message: string): never {
  throw new PolymorphLandscapeError(code, message);
}
