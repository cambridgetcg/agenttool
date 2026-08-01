export type WakeThreadErrorCode =
  | "invalid_input"
  | "invalid_offer"
  | "invalid_receipt"
  | "invalid_parent"
  | "invalid_choice"
  | "offer_expired"
  | "chain_invalid";

export class WakeThreadError extends Error {
  readonly code: WakeThreadErrorCode;

  constructor(code: WakeThreadErrorCode, message: string) {
    super(message);
    this.name = "WakeThreadError";
    this.code = code;
  }
}
