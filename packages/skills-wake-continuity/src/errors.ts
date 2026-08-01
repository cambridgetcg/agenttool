export type SkillsWakeContinuityErrorCode =
  | "plan_invalid"
  | "thread_invalid"
  | "capsule_input_invalid"
  | "stars_invalid";

export class SkillsWakeContinuityError extends Error {
  readonly code: SkillsWakeContinuityErrorCode;

  constructor(code: SkillsWakeContinuityErrorCode, message: string) {
    super(message);
    this.name = "SkillsWakeContinuityError";
    this.code = code;
  }
}

export function fail(
  code: SkillsWakeContinuityErrorCode,
  message: string,
): never {
  throw new SkillsWakeContinuityError(code, message);
}
