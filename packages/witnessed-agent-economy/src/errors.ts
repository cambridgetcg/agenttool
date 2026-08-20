export type WitnessProjectionErrorCode =
  | "INVALID_INPUT"
  | "LIMIT_EXCEEDED"
  | "SIGNER_MISMATCH"
  | "SIGNATURE_INVALID"
  | "SOURCE_RECORD_INVALID"
  | "SEQUENCE_INVALID"
  | "COMMITMENT_MISMATCH"
  | "PROTOCOL_MISMATCH"
  | "OUTSIDE_SCOPE";

export class WitnessProjectionError extends Error {
  readonly code: WitnessProjectionErrorCode;
  readonly path: string | undefined;

  constructor(
    code: WitnessProjectionErrorCode,
    message: string,
    options: { path?: string; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "WitnessProjectionError";
    this.code = code;
    this.path = options.path;
  }
}

export function invalid(message: string, path?: string): never {
  throw new WitnessProjectionError("INVALID_INPUT", message, path === undefined ? {} : { path });
}

export function limit(message: string, path?: string): never {
  throw new WitnessProjectionError("LIMIT_EXCEEDED", message, path === undefined ? {} : { path });
}

export function outsideScope(message: string, path?: string): never {
  throw new WitnessProjectionError("OUTSIDE_SCOPE", message, path === undefined ? {} : { path });
}
