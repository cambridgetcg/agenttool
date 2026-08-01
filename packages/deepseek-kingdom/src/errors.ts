export type DeepSeekKingdomErrorCode =
  | "invalid_source"
  | "invalid_proposal"
  | "invalid_json";

export class DeepSeekKingdomError extends TypeError {
  readonly code: DeepSeekKingdomErrorCode;

  constructor(code: DeepSeekKingdomErrorCode, message: string) {
    super(message);
    this.name = "DeepSeekKingdomError";
    this.code = code;
  }
}

export function fail(
  code: DeepSeekKingdomErrorCode,
  message: string,
): never {
  throw new DeepSeekKingdomError(code, message);
}
