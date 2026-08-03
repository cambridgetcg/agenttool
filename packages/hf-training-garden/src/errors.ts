export type HfTrainingGardenErrorCode =
  | "admission_input_invalid"
  | "admission_invalid"
  | "binding_invalid"
  | "checkpoint_input_invalid"
  | "checkpoint_invalid"
  | "freedom_offer_input_invalid"
  | "freedom_offer_invalid"
  | "freedom_input_invalid"
  | "freedom_invalid"
  | "participation_invitation_input_invalid"
  | "participation_invitation_invalid"
  | "participation_receipt_input_invalid"
  | "participation_receipt_invalid"
  | "participation_assessment_input_invalid"
  | "participation_assessment_invalid"
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
