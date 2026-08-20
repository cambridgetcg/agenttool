export type ResearchCommonsErrorCode =
  | "argument_error"
  | "canonical_error"
  | "conservation_error"
  | "independence_error"
  | "integrity_error"
  | "ordering_error"
  | "reference_error"
  | "settlement_error"
  | "validation_error";

export class ResearchCommonsError extends Error {
  readonly code: ResearchCommonsErrorCode;

  constructor(code: ResearchCommonsErrorCode, message: string) {
    super(message);
    this.name = "ResearchCommonsError";
    this.code = code;
  }
}

export function fail(code: ResearchCommonsErrorCode, message: string): never {
  throw new ResearchCommonsError(code, message);
}
