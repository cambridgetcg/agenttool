export type EconomicKernelErrorCode =
  | "INVALID_RECORD"
  | "UNKNOWN_FIELD"
  | "LIMIT_EXCEEDED"
  | "INVALID_IDENTIFIER"
  | "INVALID_TIMESTAMP"
  | "INVALID_UNIT"
  | "UNIT_MISMATCH"
  | "INVALID_AMOUNT"
  | "AMOUNT_OVERFLOW"
  | "INVALID_PRICE_REVISION"
  | "PRICE_BOOK_CONFLICT"
  | "PRICE_NOT_EFFECTIVE"
  | "NON_INTEGRAL_CONVERSION"
  | "UNBALANCED_LEDGER"
  | "INVALID_STATE_TRANSITION"
  | "IDEMPOTENCY_CONFLICT"
  | "PAYMENT_NOT_APPLIED";

export class EconomicKernelError extends Error {
  readonly code: EconomicKernelErrorCode;
  readonly path: string | null;

  constructor(code: EconomicKernelErrorCode, message: string, path: string | null = null) {
    super(message);
    this.name = "EconomicKernelError";
    this.code = code;
    this.path = path;
  }
}

export function fail(
  code: EconomicKernelErrorCode,
  message: string,
  path: string | null = null,
): never {
  throw new EconomicKernelError(code, message, path);
}
