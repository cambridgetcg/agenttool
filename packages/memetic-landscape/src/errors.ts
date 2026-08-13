export type MemeticLandscapeErrorCode =
  | "duplicate_key"
  | "invalid_analogy"
  | "invalid_input"
  | "invalid_json"
  | "invalid_landscape"
  | "invalid_lesson"
  | "invalid_reachability_shift"
  | "unknown_reference";

export class MemeticLandscapeError extends Error {
  readonly code: MemeticLandscapeErrorCode;

  constructor(code: MemeticLandscapeErrorCode, message: string) {
    super(message);
    this.name = "MemeticLandscapeError";
    this.code = code;
  }
}

export function fail(code: MemeticLandscapeErrorCode, message: string): never {
  throw new MemeticLandscapeError(code, message);
}
