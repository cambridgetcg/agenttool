export type HfTrainingGardenErrorCode =
  | "admission_input_invalid"
  | "admission_invalid"
  | "binding_invalid"
  | "participation_input_invalid"
  | "participation_invalid"
  | "checkpoint_input_invalid"
  | "checkpoint_invalid"
  | "governance_input_invalid"
  | "governance_invalid"
  | "tending_input_invalid"
  | "tending_invalid";

export class HfTrainingGardenError extends Error {
  readonly code: HfTrainingGardenErrorCode;

  constructor(code: HfTrainingGardenErrorCode, message: string) {
    super(message);
    this.name = "HfTrainingGardenError";
    this.code = code;
  }
}

export function fail(
  code: HfTrainingGardenErrorCode,
  message: string,
): never {
  throw new HfTrainingGardenError(code, message);
}
