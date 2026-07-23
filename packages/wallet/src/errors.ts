export type WalletProtocolErrorCode =
  | "INVALID_INPUT"
  | "LIMIT_EXCEEDED"
  | "INTEGRITY_FAILURE"
  | "SIGNATURE_INVALID"
  | "AUTHORITY_MISMATCH"
  | "CAPABILITY_INACTIVE"
  | "CAPABILITY_REVOKED"
  | "CAPABILITY_EXHAUSTED"
  | "CAPABILITY_DENIED"
  | "SIMULATION_INVALID"
  | "SIMULATION_STALE"
  | "SIGNER_RESPONSE_MISMATCH"
  | "INVALID_STATE_TRANSITION"
  | "CONTINUITY_CONFLICT";

export class WalletProtocolError extends Error {
  readonly code: WalletProtocolErrorCode;
  readonly path: string | undefined;
  readonly cause: unknown;

  constructor(
    code: WalletProtocolErrorCode,
    message: string,
    options?: { path?: string; cause?: unknown },
  ) {
    super(message);
    this.name = "WalletProtocolError";
    this.code = code;
    this.path = options?.path;
    this.cause = options?.cause;
  }
}

export function invalid(message: string, path?: string): never {
  throw new WalletProtocolError("INVALID_INPUT", message, path ? { path } : undefined);
}

export function limit(message: string, path?: string): never {
  throw new WalletProtocolError("LIMIT_EXCEEDED", message, path ? { path } : undefined);
}
